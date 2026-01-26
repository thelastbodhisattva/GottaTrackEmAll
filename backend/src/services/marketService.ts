import { config } from '../config/index.js';
import { Market, MarketCategory } from '../types/index.js';
import { cacheGet, cacheSet, CacheKeys, CacheTTL, isRedisConnected } from '../cache/redis.js';

/**
 * In-memory market cache (by conditionId/slug)
 */
const marketCache = new Map<string, Market>();

/**
 * Token ID to market cache (maps asset_id to Market)
 * This is needed because WebSocket sends asset_id but we need market data
 */
const tokenToMarketCache = new Map<string, Market>();

/**
 * Gamma API URL for market lookups by token ID
 */
const GAMMA_API_URL = 'https://gamma-api.polymarket.com/markets';

/**
 * Category keywords for classification
 */
const categoryKeywords: Record<MarketCategory, string[]> = {
    geopolitics: [
        'election', 'president', 'prime minister', 'vote', 'referendum',
        'congress', 'senate', 'parliament', 'government', 'policy',
        'trump', 'biden', 'democrat', 'republican', 'party',
        'maduro', 'putin', 'xi', 'modi', 'macron', 'regime',
    ],
    war: [
        'war', 'conflict', 'military', 'invasion', 'attack',
        'ukraine', 'russia', 'israel', 'hamas', 'iran',
        'nato', 'troops', 'missile', 'strike', 'ceasefire',
        'nuclear', 'sanctions', 'defense', 'army', 'navy',
    ],
    crypto: [
        'bitcoin', 'btc', 'ethereum', 'eth', 'crypto',
        'token', 'blockchain', 'defi', 'nft', 'sec',
        'binance', 'coinbase', 'solana', 'xrp', 'regulation',
        'etf', 'halving', 'altcoin', 'stablecoin', 'usdc',
    ],
    sports: [
        'nba', 'nfl', 'mlb', 'nhl', 'soccer', 'football',
        'basketball', 'baseball', 'hockey', 'tennis', 'golf',
        'championship', 'playoffs', 'super bowl', 'world series',
    ],
    esports: [
        'esports', 'league of legends', 'dota', 'csgo', 'valorant',
        'overwatch', 'fortnite', 'gaming', 'tournament',
    ],
    popculture: [
        'celebrity', 'hollywood', 'music', 'album', 'movie',
        'oscar', 'grammy', 'emmy', 'award', 'release',
    ],
    entertainment: [
        'tv', 'show', 'streaming', 'netflix', 'disney',
        'box office', 'premiere', 'ratings',
    ],
    science: [
        'nasa', 'space', 'mars', 'moon', 'climate',
        'vaccine', 'fda', 'research', 'discovery', 'ai',
    ],
    other: [],
};

/**
 * Market service for fetching and caching market metadata
 */
export class MarketService {
    private readonly apiUrl: string;


    constructor(apiUrl?: string) {
        this.apiUrl = apiUrl || config.polymarket.apiUrl;
    }

    /**
     * Get market by ID with caching (Redis + in-memory)
     * Supports both market slugs/conditionIds AND token IDs (asset_id)
     */
    async getMarket(marketId: string): Promise<Market | null> {
        // Check token cache first (for asset_id lookups)
        const tokenCached = tokenToMarketCache.get(marketId);
        if (tokenCached) {
            return tokenCached;
        }

        // Check Redis cache first (if available)
        if (isRedisConnected()) {
            const redisCached = await cacheGet<Market>(CacheKeys.market(marketId), 'market');
            if (redisCached) {
                // Also update in-memory cache
                marketCache.set(marketId, redisCached);
                return redisCached;
            }
        }

        // Check in-memory cache
        const cached = marketCache.get(marketId);
        if (cached) {
            return cached;
        }

        try {
            // Detect if this is a token ID (long numeric string) vs market slug
            const isTokenId = /^\d{10,}$/.test(marketId);

            if (isTokenId) {
                // Use Gamma API to lookup by clobTokenIds
                return await this.fetchMarketByTokenId(marketId);
            }

            // Fetch from Polymarket CLOB API (for slugs/conditionIds)
            const response = await fetch(`${this.apiUrl}/markets/${marketId}`);

            const data = await response.json() as {
                conditionId: string;
                questionId: string;
                question: string;
                description: string;
                outcomes: string; // Gamma API returns stringified JSON
                endDate: string;
                volume: string;
                liquidity: string;
                active: boolean;
                closed: boolean;
                resolved: boolean;
            };

            // Parse outcomes if string
            let outcomes: string[] = [];
            try {
                if (typeof data.outcomes === 'string') {
                    outcomes = JSON.parse(data.outcomes);
                } else if (Array.isArray(data.outcomes)) {
                    outcomes = data.outcomes;
                }
            } catch (e) {
                outcomes = [];
            }

            // Safe date parsing - try multiple possible field names from different API versions
            let parsedEndDate: Date;
            const rawEndDate = (data as any).endDate || (data as any).end_date_iso || (data as any).end_date || (data as any).expirationTime;

            try {
                parsedEndDate = new Date(rawEndDate);
                if (isNaN(parsedEndDate.getTime()) || !rawEndDate) {
                    // Use default for markets without end dates (ongoing/perpetual)
                    // Don't log every time - this is common for some market types
                    parsedEndDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // +30 days default
                }
            } catch (e) {
                parsedEndDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
            }

            const market: Market = {
                id: marketId,
                conditionId: data.conditionId,
                questionId: data.questionId,
                title: data.question,
                description: data.description,
                category: this.classifyMarket(data.question, data.description),
                outcomes: outcomes,
                endDate: parsedEndDate,
                volume: parseFloat(data.volume) || 0,
                liquidity: parseFloat(data.liquidity) || 0,
                lastPrice: 0, // Gamma API doesn't always provide simple last price, handled in TradeProcessor
                resolved: data.resolved || data.closed,
                resolutionOutcome: '', // Not strictly needed for live scoring
            };

            // Cache the market (Redis + in-memory)
            if (isRedisConnected()) {
                await cacheSet(CacheKeys.market(marketId), market, CacheTTL.market);
            }
            marketCache.set(marketId, market);

            return market;
        } catch (error) {
            console.error(`[MarketService] Error fetching market ${marketId}:`, error);
            return null;
        }
    }

    /**
     * Fetch market by token ID (asset_id) from Gamma API
     * The Gamma API stores token IDs in the clobTokenIds field
     */
    private async fetchMarketByTokenId(tokenId: string): Promise<Market | null> {
        try {
            // Query Gamma API - it returns markets where clobTokenIds contains this token
            const response = await fetch(`${GAMMA_API_URL}?clob_token_ids=${tokenId}&limit=1`);

            if (!response.ok) {
                if (response.status === 404) {
                    return null;
                }
                throw new Error(`Gamma API error: ${response.status}`);
            }

            const markets = await response.json() as Array<{
                id: string;
                conditionId: string;
                questionId?: string;
                question: string;
                description: string;
                outcomes?: string;
                endDate?: string;
                volume?: string;
                liquidity?: string;
                active?: boolean;
                closed?: boolean;
                resolved?: boolean;
                clobTokenIds?: string;
                slug?: string;  // Market slug for URL
                events?: Array<{ slug?: string; ticker?: string }>;  // Event info
            }>;

            if (!markets || markets.length === 0) {
                return null;
            }

            const data = markets[0];

            // Parse outcomes if string
            let outcomes: string[] = [];
            try {
                if (typeof data.outcomes === 'string') {
                    outcomes = JSON.parse(data.outcomes);
                } else if (Array.isArray(data.outcomes)) {
                    outcomes = data.outcomes as unknown as string[];
                }
            } catch {
                outcomes = ['Yes', 'No']; // Default for binary markets
            }

            // Safe date parsing
            let parsedEndDate: Date;
            try {
                parsedEndDate = new Date(data.endDate || '');
                if (isNaN(parsedEndDate.getTime())) {
                    parsedEndDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // +30 days default
                }
            } catch {
                parsedEndDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
            }

            // Extract event slug if available (events[0].slug)
            const eventSlug = data.events?.[0]?.slug || data.events?.[0]?.ticker;

            const market: Market = {
                id: data.conditionId || data.id,
                conditionId: data.conditionId,
                questionId: data.questionId || '',
                title: data.question,
                description: data.description || '',
                category: this.classifyMarket(data.question, data.description || ''),
                outcomes: outcomes,
                endDate: parsedEndDate,
                volume: parseFloat(data.volume || '0') || 0,
                liquidity: parseFloat(data.liquidity || '0') || 0,
                lastPrice: 0,
                resolved: data.resolved || data.closed || false,
                resolutionOutcome: '',
                slug: data.slug,           // Store market slug for URL
                eventSlug: eventSlug,      // Store event slug for URL
            };

            // Cache the market by BOTH conditionId AND tokenId
            marketCache.set(market.id, market);
            tokenToMarketCache.set(tokenId, market);

            // Also cache in Redis if available
            if (isRedisConnected()) {
                await cacheSet(CacheKeys.market(market.id), market, CacheTTL.market);
            }

            console.log(`[MarketService] ✅ Found market by tokenId: "${data.question.slice(0, 50)}..."`);
            return market;
        } catch (error) {
            console.error(`[MarketService] Error fetching market by tokenId ${tokenId}:`, error);
            return null;
        }
    }

    /**
     * Get recent trades for a market (includes maker/taker addresses)
     * Uses Data API which is public (CLOB requires auth)
     */
    async getRecentTrades(marketId: string, limit: number = 5): Promise<{
        id: string;
        maker_address: string;
        taker_address: string;
        price: string;
        size: string;
        timestamp: string;
        transaction_hash?: string;
    }[]> {
        const url = `https://data-api.polymarket.com/trades?market=${marketId}&limit=${limit}`;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[MarketService] Fetching trades from Data API: ${url.slice(0, 80)}...`);

                const response = await fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'PolyWhaleTracker/1.0'
                    },
                    signal: AbortSignal.timeout(10000) // 10s timeout
                });

                if (!response.ok) {
                    // Retry on 5xx errors
                    if (response.status >= 500 && attempt < maxRetries) {
                        const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
                        console.warn(`[MarketService] Data API returned ${response.status}, retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    console.warn(`[MarketService] Trades API returned ${response.status}`);
                    return [];
                }

                const data = await response.json();
                const trades = Array.isArray(data) ? data : [];
                console.log(`[MarketService] Got ${trades.length} trade(s)`);
                return trades;
            } catch (error: unknown) {
                const err = error as any;
                // Retry on timeout/network errors
                if (attempt < maxRetries && (err?.name === 'TimeoutError' || err?.code === 'ECONNRESET')) {
                    const delay = 1000 * Math.pow(2, attempt - 1);
                    console.warn(`[MarketService] Request failed (${err?.name || 'error'}), retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                console.error(`[MarketService] Error fetching trades for ${marketId}:`, err?.message || err);
                return [];
            }
        }

        return [];
    }

    /**
     * Get a specific trade by asset (token_id) OR conditionId and size/price match
     * Returns the proxyWallet for Polymarket profile link
     * 
     * The Data API returns trades with:
     * - proxyWallet: The user's Polymarket profile address
     * - asset: The token_id (our marketId)
     * - conditionId: Market's unique condition ID (BEST for filtering!)
     * - size, price: For matching the specific trade
     */
    async getTradeByAsset(
        assetId: string,
        targetSize: number,
        targetPrice: number,
        conditionId?: string  // Optional but HIGHLY RECOMMENDED for accurate matching
    ): Promise<{
        proxyWallet: string;
        transactionHash: string;
        size: number;
        price: number;
    } | null> {
        // STRATEGY: Parallel Deep Fetch
        // Fetch 2500 trades (5 pages x 500) concurrently to catch whale trades
        // that get buried instantly by high-frequency crypto volume.
        const BATCH_SIZE = 500;
        const PARALLEL_REQUESTS = 5;
        const TOTAL_TRADES = BATCH_SIZE * PARALLEL_REQUESTS;

        try {
            const matchInfo = conditionId
                ? `conditionId ${conditionId.slice(0, 20)}...`
                : `asset ${assetId.slice(0, 20)}...`;

            console.log(`[MarketService] 🚀 PARALLEL FETCH: searching ${TOTAL_TRADES} trades for ${matchInfo}`);

            // Create 5 parallel fetch promises
            const fetchPromises = Array.from({ length: PARALLEL_REQUESTS }, (_, i) => {
                const offset = i * BATCH_SIZE;
                const url = `https://data-api.polymarket.com/trades?limit=${BATCH_SIZE}&offset=${offset}`;

                return fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'PolyWhaleTracker/1.0'
                    },
                    signal: AbortSignal.timeout(15000)
                })
                    .then(res => res.ok ? res.json() : [])
                    .catch(err => {
                        console.warn(`[MarketService] Failed to fetch batch offset ${offset}: ${err.message}`);
                        return [];
                    });
            });

            // Wait for all requests
            const results = await Promise.all(fetchPromises);

            // Flatten and deduplicate
            const allTrades = (results as any[][]).flat();
            console.log(`[MarketService] 📥 Received ${allTrades.length} unique trades from API`);


            // BEST STRATEGY: Filter by conditionId (unique per market!)
            if (conditionId) {
                const marketTrades = allTrades.filter(t => t.conditionId === conditionId);
                console.log(`[MarketService] Found ${marketTrades.length} trades for this market`);

                if (marketTrades.length > 0) {
                    // 1. Group by proxyWallet to handle multi-fill trades
                    // A whale buying $10k might be split into 5 trades of $2k in the API
                    const walletVolumes = new Map<string, { totalUsd: number, totalSize: number, txHash: string, trades: any[] }>();

                    for (const trade of marketTrades) {
                        const wallet = trade.proxyWallet;
                        if (!wallet) continue;

                        const info = walletVolumes.get(wallet) || { totalUsd: 0, totalSize: 0, txHash: trade.transactionHash, trades: [] as any[] };
                        const tradeUsd = parseFloat(trade.size) * parseFloat(trade.price);

                        info.totalUsd += tradeUsd;
                        info.totalSize += parseFloat(trade.size);
                        info.trades.push(trade);
                        walletVolumes.set(wallet, info);
                    }

                    console.log(`[MarketService] Found ${walletVolumes.size} unique wallets trading this market`);

                    const targetUsd = targetSize * targetPrice;

                    // 2. Check aggregated volumes against target
                    for (const [wallet, info] of walletVolumes.entries()) {
                        // Wide tolerance (20% to 500%) for aggregation differences
                        if (info.totalUsd > targetUsd * 0.2 && info.totalUsd < targetUsd * 5) {
                            console.log(`[MarketService] ✅ Found AGGREGATED match! Wallet: ${wallet.slice(0, 10)}... Total: $${info.totalUsd.toFixed(0)} (Target: $${targetUsd.toFixed(0)})`);
                            return {
                                proxyWallet: wallet,
                                transactionHash: info.txHash,
                                size: info.totalSize,
                                price: info.totalUsd / info.totalSize // Average price
                            };
                        }
                    }

                    // 3. Fallback: Return the wallet with the LARGEST volume
                    // If the whale swept the book, they are likely the biggest volume in the last few seconds
                    let maxVolWallet = '';
                    let maxVol = 0;

                    for (const [wallet, info] of walletVolumes.entries()) {
                        if (info.totalUsd > maxVol) {
                            maxVol = info.totalUsd;
                            maxVolWallet = wallet;
                        }
                    }

                    if (maxVol > 0) {
                        const targetUsd = targetSize * targetPrice;
                        const info = walletVolumes.get(maxVolWallet)!;

                        // SAFETY CHECK: Only use fallback if volume is at least 10% of target
                        // Prevents matching a $62 trade to an $18,000 whale (which happened!)
                        if (maxVol > targetUsd * 0.1) {
                            console.log(`[MarketService] ✅ Using LARGEST volume wallet: ${maxVolWallet.slice(0, 10)}... Vol: $${maxVol.toFixed(0)}`);
                            return {
                                proxyWallet: maxVolWallet,
                                transactionHash: info.txHash,
                                size: info.totalSize,
                                price: info.totalUsd / info.totalSize
                            };
                        } else {
                            console.log(`[MarketService] ⚠️ Found largest wallet ${maxVolWallet.slice(0, 10)}... but volume $${maxVol.toFixed(0)} is too small (<10% of target $${targetUsd.toFixed(0)})`);
                        }
                    }
                }
            }

            // FALLBACK: Exact asset ID match + size/price match
            for (const trade of allTrades) {
                if (trade.asset === assetId) {
                    const size = parseFloat(trade.size);
                    const price = parseFloat(trade.price);

                    // Check if this is our trade (15% tolerance)
                    const sizeTolerance = targetSize * 0.15;
                    const priceTolerance = Math.max(targetPrice * 0.05, 0.01);

                    if (Math.abs(size - targetSize) < sizeTolerance &&
                        Math.abs(price - targetPrice) < priceTolerance) {
                        console.log(`[MarketService] ✅ Found EXACT asset match! Proxy: ${trade.proxyWallet?.slice(0, 12)}...`);
                        return {
                            proxyWallet: trade.proxyWallet,
                            transactionHash: trade.transactionHash,
                            size,
                            price
                        };
                    }
                }
            }

            // Strategy 2: Fuzzy asset match (last 15 chars) + price match
            for (const trade of allTrades) {
                const tradeAsset = trade.asset || '';
                const assetMatch = tradeAsset.slice(-15) === assetId.slice(-15);

                if (assetMatch) {
                    const size = parseFloat(trade.size);
                    const targetUsd = targetSize * targetPrice;
                    const tradeUsd = size * parseFloat(trade.price);

                    // Check if USD value matches (20% tolerance)
                    if (Math.abs(tradeUsd - targetUsd) < targetUsd * 0.2) {
                        console.log(`[MarketService] ✅ Found fuzzy asset match! Proxy: ${trade.proxyWallet?.slice(0, 12)}...`);
                        return {
                            proxyWallet: trade.proxyWallet,
                            transactionHash: trade.transactionHash,
                            size,
                            price: parseFloat(trade.price)
                        };
                    }
                }
            }

            // Strategy 3: Large USD value match only (for true whale trades $10k+)
            // This is risky but better than no profile for major trades
            const targetUsd = targetSize * targetPrice;
            if (targetUsd >= 10000) { // Only for $10k+ trades
                for (const trade of allTrades) {
                    const size = parseFloat(trade.size);
                    const price = parseFloat(trade.price);
                    const tradeUsd = size * price;

                    // Very tight USD match (5%) for large trades
                    if (Math.abs(tradeUsd - targetUsd) < targetUsd * 0.05) {
                        console.log(`[MarketService] ✅ Found large USD match ($${tradeUsd.toFixed(0)})! Proxy: ${trade.proxyWallet?.slice(0, 12)}...`);
                        return {
                            proxyWallet: trade.proxyWallet,
                            transactionHash: trade.transactionHash,
                            size,
                            price
                        };
                    }
                }
            }

            console.log(`[MarketService] No matching trade found in ${allTrades.length} recent trades`);
            return null;
        } catch (error) {
            console.error(`[MarketService] Error fetching trade by asset:`, error);
            return null;
        }
    }

    /**
     * Classify market into category based on keywords
     */
    private classifyMarket(title: string, description: string): MarketCategory {
        const text = `${title} ${description}`.toLowerCase();

        // Check each category
        for (const [category, keywords] of Object.entries(categoryKeywords)) {
            if (category === 'other') continue;

            for (const keyword of keywords) {
                if (text.includes(keyword.toLowerCase())) {
                    return category as MarketCategory;
                }
            }
        }

        return 'other';
    }

    /**
     * Get markets by category
     */
    async getMarketsByCategory(category: MarketCategory): Promise<Market[]> {
        const markets = Array.from(marketCache.values());
        return markets.filter(m => m.category === category);
    }

    /**
     * Get active markets (not resolved)
     */
    async getActiveMarkets(): Promise<Market[]> {
        const markets = Array.from(marketCache.values());
        return markets.filter(m => !m.resolved);
    }

    /**
     * Fetch and cache multiple markets
     */
    async fetchMarkets(marketIds: string[]): Promise<Market[]> {
        const markets: Market[] = [];

        for (const id of marketIds) {
            const market = await this.getMarket(id);
            if (market) {
                markets.push(market);
            }
        }

        return markets;
    }

    /**
     * Clear cache (for testing or refresh)
     */
    clearCache(): void {
        marketCache.clear();
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; categories: Record<MarketCategory, number> } {
        const markets = Array.from(marketCache.values());
        const categories: Record<MarketCategory, number> = {
            geopolitics: 0,
            war: 0,
            crypto: 0,
            sports: 0,
            esports: 0,
            popculture: 0,
            entertainment: 0,
            science: 0,
            other: 0,
        };

        for (const market of markets) {
            categories[market.category]++;
        }

        return {
            size: marketCache.size,
            categories,
        };
    }
}
