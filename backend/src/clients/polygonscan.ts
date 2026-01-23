import { config } from '../config/index.js';
import { WalletData } from '../types/index.js';

/**
 * Client for Polygonscan API to fetch on-chain wallet data
 */
export class PolygonscanClient {
    private readonly apiKey: string;
    private readonly baseUrl = 'https://api.polygonscan.com/api';

    constructor(apiKey?: string) {
        this.apiKey = apiKey || config.polygonscanApiKey;
    }

    /**
     * Get wallet creation time and basic data
     */
    async getWalletData(address: string): Promise<WalletData> {
        // Skip invalid addresses
        if (!address || address === 'Unknown' || !address.startsWith('0x')) {
            console.warn(`[Polygonscan] Invalid address: ${address}`);
            return this.getDefaultWalletData(address);
        }

        try {
            // Get first transaction to determine wallet age
            const firstTxResponse = await this.fetchApi<any[]>('account', 'txlist', {
                address,
                startblock: 0,
                endblock: 99999999,
                page: 1,
                offset: 1,
                sort: 'asc',
            });

            // Get current balance
            const balanceResponse = await this.fetchApi<string>('account', 'balance', {
                address,
                tag: 'latest',
            });

            // Get transaction count
            const txCountResponse = await this.fetchApi<any[]>('account', 'txlist', {
                address,
                startblock: 0,
                endblock: 99999999,
                page: 1,
                offset: 1,
                sort: 'desc',
            });

            // Parse wallet creation time from first transaction
            const firstTx = firstTxResponse.result?.[0];
            let createdAt: number;
            if (firstTx && firstTx.timeStamp) {
                const parsedTime = parseInt(firstTx.timeStamp, 10) * 1000;
                createdAt = isNaN(parsedTime) ? Date.now() - (365 * 24 * 60 * 60 * 1000) : parsedTime;
            } else {
                // No transactions found - could be a fresh wallet or Polygonscan issue
                createdAt = Date.now() - (365 * 24 * 60 * 60 * 1000); // Default: assume 1 year old
            }

            // Determine funding source from first incoming transaction
            const fundingSource = await this.determineFundingSource(address);

            // Get last activity before recent trades
            const lastActive = await this.getLastActiveTime(address);

            const walletAge = (Date.now() - createdAt) / (1000 * 60 * 60);
            const txCount = Array.isArray(txCountResponse.result) ? txCountResponse.result.length : 0;
            console.log(`[Polygonscan] Wallet ${address.slice(0, 10)}...: age=${walletAge.toFixed(0)}h, txCount=${txCount}, fundingSource=${fundingSource?.type || 'unknown'}`);

            return {
                address,
                createdAt,
                lastActiveBeforeTrade: lastActive,
                balance: parseFloat(balanceResponse.result || '0') / 1e18,
                txCount: Array.isArray(txCountResponse.result) ? txCountResponse.result.length : 0,
                fundingSource,
            };
        } catch (error) {
            console.error(`[Polygonscan] Error fetching wallet data for ${address.slice(0, 10)}...:`, error);
            return this.getDefaultWalletData(address);
        }
    }

    /**
     * Get default wallet data when API fails - assumes established wallet to avoid false positives
     */
    private getDefaultWalletData(address: string): WalletData {
        return {
            address,
            createdAt: Date.now() - (365 * 24 * 60 * 60 * 1000), // Default: 1 year old (established wallet)
            balance: 0,
            txCount: 0,
        };
    }

    /**
     * Get wallet positions (token balances relevant to Polymarket)
     */
    async getWalletPositions(address: string): Promise<{ marketId: string; value: number }[]> {
        try {
            // Fetch ERC-1155 token transfers (Polymarket outcome tokens)
            const response = await this.fetchApi<any[]>('account', 'token1155tx', {
                address,
                startblock: 0,
                endblock: 99999999,
                page: 1,
                offset: 100,
                sort: 'desc',
            });

            if (!response.result || !Array.isArray(response.result) || response.result.length === 0) {
                return [];
            }

            // Aggregate positions by token ID (market outcome)
            const positions = new Map<string, number>();

            for (const tx of response.result) {
                const tokenId = tx.tokenID;
                const value = parseFloat(tx.tokenValue || '0');
                const isIncoming = tx.to.toLowerCase() === address.toLowerCase();

                const current = positions.get(tokenId) || 0;
                positions.set(tokenId, isIncoming ? current + value : current - value);
            }

            return Array.from(positions.entries())
                .filter(([_, value]) => value > 0)
                .map(([marketId, value]) => ({ marketId, value }));
        } catch (error) {
            console.error(`[Polygonscan] Error fetching positions for ${address}:`, error);
            return [];
        }
    }

    /**
     * Determine the funding source of a wallet
     */
    private async determineFundingSource(address: string): Promise<WalletData['fundingSource']> {
        try {
            // Get first incoming transaction
            const response = await this.fetchApi<any[]>('account', 'txlist', {
                address,
                startblock: 0,
                endblock: 99999999,
                page: 1,
                offset: 10,
                sort: 'asc',
            });

            if (!response.result || !Array.isArray(response.result) || response.result.length === 0) {
                return { type: 'unknown' };
            }

            // Find first incoming transaction
            const incomingTx = response.result.find(
                (tx: { to: string }) => tx && tx.to && tx.to.toLowerCase() === address.toLowerCase()
            );

            if (!incomingTx) {
                return { type: 'unknown' };
            }

            const fromAddress = incomingTx.from;

            // Known exchange and bridge addresses on Polygon
            const knownExchanges: Record<string, string> = {
                // Binance
                '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance',
                '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance',
                '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance',
                '0xf977814e90da44bfa03b6295a0616a897441acec': 'Binance',
                '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8': 'Binance',
                // Coinbase
                '0x503828976d22510aad0201ac7ec88293211d23da': 'Coinbase',
                '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase',
                '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': 'Coinbase',
                // Kraken
                '0x8894e0a0c962cb723c1976a4421c95949be2d4e3': 'Kraken',
                '0xda9dfa130df4de4673b89022ee50ff26f6ea73cf': 'Kraken',
                // OKX
                '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX',
                '0x98ec059dc3adfbdd63429454aeb0c990fba4a128': 'OKX',
                // Bybit
                '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit',
                // KuCoin
                '0x2b5634c42055806a59e9107ed44d43c426e58258': 'KuCoin',
                // Polygon Bridge
                '0x5a51e2ebf8d136926b9ca7b59b60464e7c44d2eb': 'PolygonBridge',
                '0x8484ef722627bf18ca5ae6bcf031c23e6e922b30': 'PolygonBridge',
                '0xa45b77a98e2b840617e2ec6ddfbf71403bdcb683': 'PolygonBridge',
                // LayerZero / Stargate Bridge
                '0x45a01e4e04f14f7a4a6702c74187c5f6222033cd': 'Stargate',
                // Multichain Bridge
                '0x1e4cf1e7c02d7f98e3c0c30b70e9ecbb2cb8e6a7': 'Multichain',
            };

            const normalizedFrom = fromAddress.toLowerCase();
            if (knownExchanges[normalizedFrom]) {
                console.log(`[Polygonscan] Detected CEX funding from ${knownExchanges[normalizedFrom]}`);
                return {
                    type: 'exchange',
                    address: fromAddress,
                    label: knownExchanges[normalizedFrom],
                };
            }

            // Check if from address is a contract
            const codeResponse = await this.fetchApi<string>('proxy', 'eth_getCode', {
                address: fromAddress,
                tag: 'latest',
            });

            if (codeResponse.result && codeResponse.result !== '0x') {
                return { type: 'contract', address: fromAddress };
            }

            return { type: 'wallet', address: fromAddress };
        } catch (error) {
            console.error(`[Polygonscan] Error determining funding source:`, error);
            return { type: 'unknown' };
        }
    }

    /**
     * Get the last activity time before recent burst
     */
    private async getLastActiveTime(address: string): Promise<number | undefined> {
        try {
            const response = await this.fetchApi<any[]>('account', 'txlist', {
                address,
                startblock: 0,
                endblock: 99999999,
                page: 1,
                offset: 50,
                sort: 'desc',
            });

            if (!response.result || !Array.isArray(response.result) || response.result.length < 2) {
                return undefined;
            }

            // Find gap in activity (30+ days of inactivity)
            const txs = response.result;
            for (let i = 0; i < txs.length - 1; i++) {
                const current = parseInt(txs[i].timeStamp, 10) * 1000;
                const previous = parseInt(txs[i + 1].timeStamp, 10) * 1000;
                const gap = current - previous;

                // 30 days in milliseconds
                if (gap > 30 * 24 * 60 * 60 * 1000) {
                    return previous;
                }
            }

            return undefined;
        } catch (error) {
            return undefined;
        }
    }

    /**
     * Make API request to Polygonscan
     */
    private async fetchApi<T>(
        module: string,
        action: string,
        params: Record<string, string | number>
    ): Promise<{ result: T; status: string; message: string }> {
        const url = new URL(this.baseUrl);
        url.searchParams.set('module', module);
        url.searchParams.set('action', action);
        url.searchParams.set('apikey', this.apiKey);

        for (const key of Object.keys(params)) {
            url.searchParams.set(key, String(params[key]));
        }

        const response = await fetch(url.toString());

        if (!response.ok) {
            throw new Error(`Polygonscan API error: ${response.status}`);
        }

        return response.json() as Promise<{ result: T; status: string; message: string }>;
    }
}
