import { ethers } from 'ethers';
import { config } from '../config/index.js';

/**
 * Polymarket Exchange Contract Addresses (Polygon Mainnet)
 */
const EXCHANGE_ADDRESSES = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'.toLowerCase(), // CTF Exchange (Binary YES/NO)
    '0xc5d563a36ae78145c45a50134d48a1215220f80a'.toLowerCase(), // NegRisk CTF Exchange (Multi-outcome)
];

/**
 * OrderFilled Event ABI for decoding transaction logs
 */
const ORDER_FILLED_EVENT_ABI = [
    'event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)'
];

/**
 * Rate limiting configuration for Alchemy Free Tier
 * Free tier: ~300 CUPS (Compute Units Per Second)
 * getTransactionReceipt = ~15 CU
 * Safe limit: ~5 requests/second to stay under CUPS
 */
const RATE_LIMIT = {
    maxRequestsPerSecond: 5,
    minIntervalMs: 200, // 1000ms / 5 = 200ms between requests
};

/**
 * Client for on-chain Polygon lookups via Alchemy RPC
 * Used to extract wallet addresses from Polymarket trade transactions
 * Includes rate limiting and caching to respect Alchemy free tier limits
 */
export class PolygonRpcClient {
    private provider: ethers.JsonRpcProvider | null = null;
    private iface: ethers.Interface;
    private lastRequestTime = 0;
    private walletCache = new Map<string, string>(); // txHash -> walletAddress
    private cacheMaxSize = 500;
    private isAlchemy = false;

    constructor() {
        const apiKey = config.alchemyApiKey;
        if (apiKey && apiKey !== 'YOUR_ALCHEMY_API_KEY_HERE') {
            const rpcUrl = `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`;
            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            this.isAlchemy = true;
            console.log('[PolygonRpc] ✅ Initialized with Alchemy RPC (rate limited: 5 req/s)');
        } else {
            console.warn('[PolygonRpc] ⚠️ No Alchemy API key - using fallback public RPC (rate limited)');
            console.warn('[PolygonRpc] ⚠️ Note: Wallet Age and Funding Source detection require Alchemy Key');
            this.provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
            this.isAlchemy = false;
        }
        this.iface = new ethers.Interface(ORDER_FILLED_EVENT_ABI);
    }

    /**
     * Rate limit requests to respect Alchemy CUPS limits
     */
    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < RATE_LIMIT.minIntervalMs) {
            const waitTime = RATE_LIMIT.minIntervalMs - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * Check if the client is properly initialized
     */
    isEnabled(): boolean {
        return this.provider !== null;
    }

    /**
     * Get the actual EOA (user's wallet) that sent a transaction
     * This is tx.from - the address that signed and paid gas for the transaction
     * 
     * Unlike getWalletFromTx which returns the proxy/taker from events,
     * this returns the REAL user's wallet address.
     * 
     * @param txHash - The Polygon transaction hash
     * @returns The EOA that sent the transaction, or null if not found
     */
    async getEoaFromTx(txHash: string): Promise<string | null> {
        if (!this.provider) {
            return null;
        }

        // Skip if not a valid tx hash
        if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
            return null;
        }

        try {
            await this.rateLimit();

            const tx = await this.provider.getTransaction(txHash);
            if (tx && tx.from) {
                const eoa = tx.from.toLowerCase();
                console.log(`[PolygonRpc] ✅ Got EOA from tx.from: ${eoa.slice(0, 10)}...`);
                return eoa;
            }

            return null;
        } catch (error) {
            console.error(`[PolygonRpc] Error getting EOA from tx:`, error);
            return null;
        }
    }

    /**
     * Find a recent trade on-chain by asset ID using Alchemy's getAssetTransfers
     * Queries ERC-1155 transfers to CTF Exchange contracts
     * 
     * @param assetId - The token ID (asset_id) from the trade
     * @param approximateSize - The approximate trade size in shares
     * @param blockRange - How many recent blocks to search (default 200)
     * @returns The EOA that made the trade, or null if not found
     */
    async findRecentTradeEoa(assetId: string, approximateSize: number, _blockRange: number = 200): Promise<string | null> {
        if (!this.provider || !this.isAlchemy) {
            return null;
        }

        try {
            await this.rateLimit();

            console.log(`[PolygonRpc] 🔗 Querying Alchemy for ERC-1155 transfers to CTF Exchange...`);

            // Query ERC-1155 transfers TO the CTF Exchange contract
            const response = await fetch(this.provider._getConnection().url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'alchemy_getAssetTransfers',
                    params: [{
                        fromBlock: 'latest',  // Most recent blocks
                        toBlock: 'latest',
                        toAddress: EXCHANGE_ADDRESSES[0], // CTF Exchange
                        category: ['erc1155'],
                        withMetadata: true,
                        maxCount: '0x14', // 20 transfers
                    }],
                }),
            });

            const data = await response.json() as any;

            if (data.result?.transfers?.length > 0) {
                console.log(`[PolygonRpc] Found ${data.result.transfers.length} recent ERC-1155 transfers to CTF Exchange`);

                // Look for a transfer with matching token ID
                for (const transfer of data.result.transfers) {
                    // Check if this transfer matches our asset ID
                    const tokenId = transfer.erc1155Metadata?.[0]?.tokenId;
                    const fromAddress = transfer.from?.toLowerCase();
                    const txHash = transfer.hash;

                    // Token ID match (fuzzy - asset IDs can be very long)
                    if (tokenId && assetId && (tokenId.includes(assetId.slice(-10)) || assetId.includes(tokenId.slice(-10)))) {
                        console.log(`[PolygonRpc] ✅ Found matching ERC-1155 transfer! From: ${fromAddress?.slice(0, 10)}...`);

                        // Get EOA from transaction
                        if (txHash) {
                            await this.rateLimit();
                            const tx = await this.provider.getTransaction(txHash);
                            if (tx?.from) {
                                const eoa = tx.from.toLowerCase();
                                console.log(`[PolygonRpc] ✅ Got EOA from ERC-1155 transfer: ${eoa.slice(0, 10)}...`);
                                return eoa;
                            }
                        }

                        // Fallback: use the from address directly
                        if (fromAddress) {
                            return fromAddress;
                        }
                    }
                }

                // If no exact match, return the most recent transfer's sender
                // This is a best-effort fallback for whale trades
                const mostRecent = data.result.transfers[0];
                if (mostRecent?.hash) {
                    await this.rateLimit();
                    const tx = await this.provider.getTransaction(mostRecent.hash);
                    if (tx?.from) {
                        const eoa = tx.from.toLowerCase();
                        console.log(`[PolygonRpc] ⚡ Using most recent CTF trade EOA: ${eoa.slice(0, 10)}...`);
                        return eoa;
                    }
                }
            }

            console.log(`[PolygonRpc] No matching on-chain trade found`);
            return null;
        } catch (error) {
            console.error(`[PolygonRpc] Error searching on-chain trades:`, error);
            return null;
        }
    }

    /**
     * Extract the taker wallet address from a Polymarket trade transaction
     * Parses OrderFilled event logs from the Polymarket exchange contracts
     * 
     * @param txHash - The Polygon transaction hash from the trade
     * @returns The taker wallet address, or null if not found
     */
    async getWalletFromTx(txHash: string): Promise<string | null> {
        if (!this.provider) {
            return null;
        }

        // Skip if not a valid tx hash
        if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
            console.warn(`[PolygonRpc] Invalid tx hash: ${txHash}`);
            return null;
        }

        // Check cache first
        const cached = this.walletCache.get(txHash);
        if (cached) {
            console.log(`[PolygonRpc] Cache hit for tx ${txHash.slice(0, 10)}...`);
            return cached;
        }

        try {
            // Rate limit before making request
            await this.rateLimit();

            const receipt = await this.provider.getTransactionReceipt(txHash);
            if (!receipt) {
                console.warn(`[PolygonRpc] Tx receipt not found for ${txHash.slice(0, 10)}...`);
                return null;
            }

            // Parse logs from Polymarket exchange contracts
            for (const log of receipt.logs) {
                if (EXCHANGE_ADDRESSES.includes(log.address.toLowerCase())) {
                    try {
                        const decoded = this.iface.parseLog({
                            topics: log.topics as string[],
                            data: log.data
                        });
                        if (decoded?.name === 'OrderFilled') {
                            const taker = decoded.args.taker as string;
                            console.log(`[PolygonRpc] ✅ Found taker wallet: ${taker.slice(0, 10)}...`);

                            // Cache the result
                            this.cacheWallet(txHash, taker);

                            return taker;
                        }
                    } catch {
                        // Not an OrderFilled event, continue
                    }
                }
            }

            console.warn(`[PolygonRpc] No OrderFilled event found in tx ${txHash.slice(0, 10)}...`);
            return null;
        } catch (error: unknown) {
            const err = error as any;
            // Handle rate limit errors specifically
            if (err?.code === 429 || err?.message?.includes('rate limit')) {
                console.warn('[PolygonRpc] Rate limited by Alchemy, backing off...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                console.error(`[PolygonRpc] Error fetching tx ${txHash.slice(0, 10)}...:`, err);
            }
            return null;
        }
    }

    /**
     * Cache wallet address with LRU eviction
     */
    private cacheWallet(txHash: string, wallet: string): void {
        // Evict oldest entries if cache is full
        if (this.walletCache.size >= this.cacheMaxSize) {
            const oldestKey = this.walletCache.keys().next().value;
            if (oldestKey) this.walletCache.delete(oldestKey);
        }
        this.walletCache.set(txHash, wallet);
    }

    /**
     * Get the maker wallet address (for trades where we want the liquidity provider)
     */
    async getMakerFromTx(txHash: string): Promise<string | null> {
        if (!this.provider) {
            return null;
        }

        if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
            return null;
        }

        try {
            // Rate limit before making request
            await this.rateLimit();

            const receipt = await this.provider.getTransactionReceipt(txHash);
            if (!receipt) {
                return null;
            }

            for (const log of receipt.logs) {
                if (EXCHANGE_ADDRESSES.includes(log.address.toLowerCase())) {
                    try {
                        const decoded = this.iface.parseLog({
                            topics: log.topics as string[],
                            data: log.data
                        });
                        if (decoded?.name === 'OrderFilled') {
                            return decoded.args.maker as string;
                        }
                    } catch {
                        // Continue to next log
                    }
                }
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; maxSize: number } {
        return {
            size: this.walletCache.size,
            maxSize: this.cacheMaxSize,
        };
    }

    /**
     * Get EOA from a Polymarket proxy address by finding recent transactions
     * Uses Alchemy's alchemy_getAssetTransfers to find who sent transactions TO this proxy
     * 
     * @param proxyAddress - The Polymarket proxy/smart wallet address
     * @returns The EOA that controls the proxy, or null if not found
     */
    async getEoaFromProxyAddress(proxyAddress: string): Promise<string | null> {
        if (!this.provider || !proxyAddress || !proxyAddress.startsWith('0x')) {
            return null;
        }

        if (!this.isAlchemy) {
            console.log('[PolygonRpc] getEoaFromProxyAddress requires Alchemy API');
            return null;
        }

        try {
            await this.rateLimit();

            // Query Alchemy for transactions TO this proxy address
            const response = await fetch(this.provider._getConnection().url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'alchemy_getAssetTransfers',
                    params: [{
                        fromBlock: '0x0',
                        toBlock: 'latest',
                        toAddress: proxyAddress,
                        category: ['external', 'erc20'],
                        maxCount: '0x5', // Get 5 most recent incoming txs
                        order: 'desc', // Most recent first
                    }],
                }),
            });

            const data = await response.json() as any;

            if (data.result?.transfers?.length > 0) {
                // Check each transaction's sender
                for (const tx of data.result.transfers) {
                    const fromAddress = tx.from?.toLowerCase();

                    if (!fromAddress) continue;

                    // Check if sender is an EOA (not a contract)
                    await this.rateLimit();
                    const code = await this.provider.getCode(fromAddress);

                    if (code === '0x' || code === '0x0') {
                        // It's an EOA - this is likely the wallet owner
                        console.log(`[PolygonRpc] ✅ Found EOA from proxy transfers: ${fromAddress.slice(0, 10)}...`);
                        return fromAddress;
                    }
                }
            }

            // Try outgoing transfers FROM the proxy (the proxy sends to exchanges, etc)
            await this.rateLimit();
            const outResponse = await fetch(this.provider._getConnection().url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'alchemy_getAssetTransfers',
                    params: [{
                        fromBlock: '0x0',
                        toBlock: 'latest',
                        fromAddress: proxyAddress,
                        category: ['external'],
                        maxCount: '0x5',
                        order: 'desc',
                    }],
                }),
            });

            const outData = await outResponse.json() as any;

            if (outData.result?.transfers?.length > 0) {
                // Get a transaction hash from outgoing transfers
                const txHash = outData.result.transfers[0].hash;
                if (txHash) {
                    // Get the actual EOA that signed this transaction
                    await this.rateLimit();
                    const tx = await this.provider.getTransaction(txHash);
                    if (tx?.from) {
                        const eoa = tx.from.toLowerCase();
                        console.log(`[PolygonRpc] ✅ Found EOA from proxy's outgoing tx: ${eoa.slice(0, 10)}...`);
                        return eoa;
                    }
                }
            }

            console.log(`[PolygonRpc] Could not find EOA for proxy ${proxyAddress.slice(0, 10)}...`);
            return null;
        } catch (error) {
            console.error(`[PolygonRpc] Error getting EOA from proxy:`, error);
            return null;
        }
    }

    /**
     * Resolve a proxy wallet (Gnosis Safe, Polymarket proxy) to its EOA owner
     * Uses eth_call to read the owner() function on the proxy contract
     * 
     * Polymarket uses smart contract wallets for trades. This function attempts
     * to find the actual user (EOA) who controls the proxy.
     */
    async resolveProxyToEoa(proxyAddress: string): Promise<string | null> {
        if (!this.provider || !proxyAddress || !proxyAddress.startsWith('0x')) {
            return null;
        }

        // Skip known non-proxy addresses (EOAs typically have low nonce)
        try {
            await this.rateLimit();

            // Check if it's actually a contract
            const code = await this.provider.getCode(proxyAddress);
            if (code === '0x' || code === '0x0') {
                // It's already an EOA, not a contract
                return null;
            }

            // Try common owner function signatures used by proxy contracts
            const ownerSignatures = [
                '0x8da5cb5b', // owner() - OpenZeppelin Ownable
                '0xa7e1931b', // getOwner() - Alternative pattern
            ];

            // Helper to check if address is valid (not zero-padded or null)
            const isValidAddress = (addr: string): boolean => {
                if (!addr || addr.length !== 42) return false;
                const withoutPrefix = addr.slice(2);
                // Count leading zeros - more than 6 means it's likely invalid/zero-padded
                let leadingZeros = 0;
                for (const char of withoutPrefix) {
                    if (char === '0') leadingZeros++;
                    else break;
                }
                // Also check for full zero address
                if (addr === '0x0000000000000000000000000000000000000000') return false;
                return leadingZeros <= 6;
            };

            for (const sig of ownerSignatures) {
                try {
                    const result = await this.provider.call({
                        to: proxyAddress,
                        data: sig
                    });

                    if (result && result !== '0x' && result.length >= 66) {
                        // Decode address from result (last 40 hex chars = 20 bytes)
                        const ownerAddress = '0x' + result.slice(-40).toLowerCase();

                        // Validate it's a real address, not zero-padded garbage
                        if (isValidAddress(ownerAddress)) {
                            console.log(`[PolygonRpc] ✅ Resolved proxy ${proxyAddress.slice(0, 10)}... to EOA ${ownerAddress.slice(0, 10)}...`);
                            return ownerAddress;
                        }
                    }
                } catch {
                    // Try next signature
                    continue;
                }
            }

            // Try Gnosis Safe getOwners() which returns an array
            try {
                const getOwnersResult = await this.provider.call({
                    to: proxyAddress,
                    data: '0xa0e67e2b' // getOwners()
                });

                if (getOwnersResult && getOwnersResult.length > 130) {
                    // First owner is at offset 64 (skip array length)
                    const firstOwner = '0x' + getOwnersResult.slice(130, 170).toLowerCase();
                    // Validate the result is a real address
                    if (isValidAddress(firstOwner)) {
                        console.log(`[PolygonRpc] ✅ Resolved Safe ${proxyAddress.slice(0, 10)}... to owner ${firstOwner.slice(0, 10)}...`);
                        return firstOwner;
                    } else {
                        console.log(`[PolygonRpc] Safe returned invalid owner ${firstOwner.slice(0, 20)}..., keeping original`);
                    }
                }
            } catch {
                // Not a Gnosis Safe
            }

            // Don't log "could not resolve" - it's fine to keep the original address
            return null;
        } catch (error) {
            console.error(`[PolygonRpc] Error resolving proxy:`, error);
            return null;
        }
    }


    /**
     * Get the exact timestamp of wallet's first transaction (for wallet age calculation)
     * Uses Alchemy's alchemy_getAssetTransfers API for accurate first tx block
     */
    async getWalletFirstTxTime(address: string): Promise<number | null> {
        if (!this.provider) {
            return null;
        }

        if (!address || !address.startsWith('0x') || address === 'Unknown') {
            return null;
        }

        // Feature requires Alchemy checks
        if (!this.isAlchemy) {
            return null;
        }

        try {
            await this.rateLimit();

            // Use Alchemy's getAssetTransfers to find first incoming/outgoing tx
            // This is more accurate than estimating from tx count
            const response = await fetch(this.provider._getConnection().url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'alchemy_getAssetTransfers',
                    params: [{
                        fromBlock: '0x0',
                        toBlock: 'latest',
                        toAddress: address,
                        category: ['external', 'erc20', 'erc721'],
                        maxCount: '0x1', // Just get the first transaction
                        order: 'asc',
                    }],
                }),
            });

            const data = await response.json() as any;

            if (data.result?.transfers?.length > 0) {
                const firstTx = data.result.transfers[0];
                const blockNum = parseInt(firstTx.blockNum, 16);

                // Get the block timestamp
                await this.rateLimit();
                const block = await this.provider.getBlock(blockNum);

                if (block && block.timestamp) {
                    const firstTxTime = block.timestamp * 1000; // Convert to ms
                    return firstTxTime;
                }
            }

            // Try outgoing transactions if no incoming found
            await this.rateLimit();
            const outResponse = await fetch(this.provider._getConnection().url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'alchemy_getAssetTransfers',
                    params: [{
                        fromBlock: '0x0',
                        toBlock: 'latest',
                        fromAddress: address,
                        category: ['external', 'erc20', 'erc721'],
                        maxCount: '0x1',
                        order: 'asc',
                    }],
                }),
            });

            const outData = await outResponse.json() as any;

            if (outData.result?.transfers?.length > 0) {
                const firstTx = outData.result.transfers[0];
                const blockNum = parseInt(firstTx.blockNum, 16);

                await this.rateLimit();
                const block = await this.provider.getBlock(blockNum);

                if (block && block.timestamp) {
                    const firstTxTime = block.timestamp * 1000;
                    return firstTxTime;
                }
            }

            // No transactions found - brand new wallet
            console.log(`[PolygonRpc] Wallet ${address.slice(0, 10)}... has no txs - fresh wallet`);
            return Date.now();
        } catch (error) {
            console.error(`[PolygonRpc] Error getting wallet first tx time:`, error);
            return null;
        }
    }

    /**
     * Check if wallet is potentially a fresh/new wallet (for insider scoring)
     */
    async isWalletFresh(address: string, thresholdHours: number = 72): Promise<boolean> {
        const firstTxTime = await this.getWalletFirstTxTime(address);
        if (firstTxTime === null) {
            return false; // Assume not fresh if we can't determine
        }

        const ageHours = (Date.now() - firstTxTime) / (1000 * 60 * 60);
        return ageHours < thresholdHours;
    }

    /**
     * Known CEX hot wallet addresses on Polygon
     * These are addresses that commonly fund new wallets from exchanges
     */
    private readonly CEX_ADDRESSES: Record<string, string> = {
        // Binance
        '0x1a1ec25dc08e98e5e93f1104b5e5cdd298707d31': 'Binance',
        '0xf977814e90da44bfa03b6295a0616a897441acec': 'Binance',
        '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance',
        '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance',
        '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance',
        '0x2140ecdc45c89ffd101a1f9b7dc3cd01f3a5ef1a': 'Binance',
        '0x8894e0a0c962cb723c1976a4421c95949be2d4e3': 'Binance',
        '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245': 'Binance',
        // Coinbase
        '0x503828976d22510aad0201ac7ec88293211d23da': 'Coinbase',
        '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740': 'Coinbase',
        '0x3cd751e6b0078be393132286c442345e5dc49699': 'Coinbase',
        '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511': 'Coinbase',
        '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': 'Coinbase',
        '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase',
        // Other CEXs
        '0x0d0707963952f2fba59dd06f2b425ace40b492fe': 'Gate.io',
        '0xd793281182a0e3e023116004778f45c29fc14f19': 'KuCoin',
        '0xeb2d2f1b8c558a40207669291fda468e50c8a0bb': 'KuCoin',
        '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3': 'OKX',
        '0x5041ed759dd4afc3a72b8192c143f72f4724081a': 'OKX',
        '0x98ec059dc3adfbdd63429454aeb0c990fba4a128': 'OKX',
        '0x3c783c21a0383057d128bae431894a5c19f9cf06': 'Bybit',
        '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit',
        '0x2f7e209e0f5f645c7612d7610193fe268f118b28': 'Crypto.com',
        '0x6262998ced04146fa42253a5c0af90ca02dfd2a3': 'Crypto.com',
        '0x46340b20830761efd32832a74d7169b29feb9758': 'Huobi',
        '0x18709e89bd403f470088abdacebe86cc60dda12e': 'Huobi',
        '0x5c985e89dde482efe97ea9f1950ad149eb73829b': 'Bitget',
        '0x97b9d2102a9a65a26e1ee82d59e42d1b73b68689': 'MEXC',
        '0x0d8824ca76e627e9cc8227faa3b3993986ce9e48': 'Kraken',
        '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0': 'Kraken',
        '0x20a9cd0f376b3b0c69f7e88d577c77ebb49a8fc8': 'Gemini',
    };

    /**
     * Known bridge contracts on Polygon
     */
    private readonly BRIDGE_ADDRESSES: Record<string, string> = {
        '0xa0c68c638235ee32657e8f720a23cec1bfc77c77': 'Polygon Bridge',
        '0x8484ef722627bf18ca5ae6bcf031c23e6e922b30': 'Polygon Plasma',
        '0x401f6c983ea34274ec46f84d70b31c151321188b': 'Layerswap',
        '0x88ad09518695c6c3712ac10a214be5109a655671': 'Socket Bridge',
        '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'Polygon USDC Bridge',
        '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae': 'LI.FI Bridge',
        '0xc0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d30006': 'Squid Router',
        '0x3a23f943181408eac424116af7b7790c94cb97a5': 'Stargate Bridge',
        '0x45a318273749d6eb00f5f6ca3bc7cd3de26d642a': 'Hop Bridge',
    };

    /**
     * Known DEX/aggregator contracts on Polygon
     */
    private readonly DEX_ADDRESSES: Record<string, string> = {
        '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap Router',
        '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3',
        '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch',
        '0x1111111254fb6c44bac0bed2854e76f90643097d': '1inch V5',
        '0xdef171fe48cf0115b1d80b88dc8eab59176fee57': 'Paraswap',
        '0x6131b5fae19ea4f9d964eac0408e4408b66337b5': 'Kyberswap',
        '0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff': 'Quickswap',
        '0xf5b509bb0909a69b1c207e495f687a596c168e12': 'SushiSwap',
        '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'Uniswap Universal',
    };

    /**
     * Detect the funding source of a wallet via Alchemy
     * Returns: { type: 'exchange'|'bridge'|'contract'|'unknown', label: string }
     */
    async detectFundingSource(address: string): Promise<{ type: string; label: string } | null> {
        if (!this.provider) {
            return null;
        }

        if (!address || !address.startsWith('0x') || address === 'Unknown') {
            return null;
        }

        // Feature requires Alchemy checks
        if (!this.isAlchemy) {
            return { type: 'unknown', label: 'Unknown (No Alchemy Key)' };
        }

        try {
            await this.rateLimit();

            // Get first few incoming transfers to this wallet
            const response = await fetch(this.provider._getConnection().url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'alchemy_getAssetTransfers',
                    params: [{
                        fromBlock: '0x0',
                        toBlock: 'latest',
                        toAddress: address,
                        category: ['external', 'erc20'],
                        maxCount: '0xa', // Get first 10 incoming txs (0xa = 10)
                        order: 'asc',
                    }],
                }),
            });

            const data = await response.json() as any;

            if (data.result?.transfers?.length > 0) {
                // Track funding source candidates
                let firstContract: string | null = null;
                let firstEoa: string | null = null;

                for (const tx of data.result.transfers) {
                    const fromAddress = tx.from?.toLowerCase();

                    if (!fromAddress) continue;

                    // 1. Check CEX (Priority 1)
                    if (this.CEX_ADDRESSES[fromAddress]) {
                        const label = this.CEX_ADDRESSES[fromAddress];
                        console.log(`[PolygonRpc] CEX funding detected: ${label} -> ${address.slice(0, 10)}...`);
                        return { type: 'exchange', label };
                    }

                    // 2. Check Bridge (Priority 2)
                    if (this.BRIDGE_ADDRESSES[fromAddress]) {
                        const label = this.BRIDGE_ADDRESSES[fromAddress];
                        console.log(`[PolygonRpc] Bridge funding detected: ${label} -> ${address.slice(0, 10)}...`);
                        return { type: 'bridge', label };
                    }

                    // 3. Check DEX (Priority 3)
                    if (this.DEX_ADDRESSES[fromAddress]) {
                        const label = this.DEX_ADDRESSES[fromAddress];
                        console.log(`[PolygonRpc] DEX funding detected: ${label} -> ${address.slice(0, 10)}...`);
                        return { type: 'contract', label };
                    }

                    // 4. Check Generic Contract
                    if (!firstContract) {
                        await this.rateLimit();
                        const code = await this.provider.getCode(fromAddress);
                        if (code && code !== '0x') {
                            firstContract = fromAddress;
                            // Keep searching for a known CEX/Bridge in history, 
                            // but remember this contract as a fallback
                        } else if (!firstEoa) {
                            firstEoa = fromAddress;
                        }
                    }
                }

                // If no known CEX/Bridge found, return best guess
                if (firstContract) {
                    console.log(`[PolygonRpc] Contract funding detected from ${firstContract.slice(0, 10)}...`);
                    return { type: 'contract', label: 'Unknown Contract' };
                }

                if (firstEoa) {
                    // EOA funding - return truncated address
                    const label = `${firstEoa.slice(0, 6)}...${firstEoa.slice(-4)}`;
                    return { type: 'unknown', label: label };
                }
            }

            console.log(`[PolygonRpc] No funding source detected for ${address.slice(0, 10)}...`);
            return { type: 'unknown', label: 'Unknown' };
        } catch (error) {
            console.error(`[PolygonRpc] Error detecting funding source:`, error);
            return null;
        }
    }
}
