import { config } from '../config/index.js';

interface GammaMarket {
    id: string;
    question: string;
    conditionId: string;
    slug: string;
    resolutionSource: string;
    endDate: string;
    liquidity: string;
    volume: string;
    clobTokenIds: string; // JSON string of [yesTokenId, noTokenId]
    active: boolean;
    closed: boolean;
    archived: boolean;
}

/**
 * Category-based liquidity thresholds
 * Higher thresholds for mature categories, lower for niche/emerging
 */
const CATEGORY_LIQUIDITY_THRESHOLDS: Record<string, number> = {
    crypto: 50000,      // High activity, lots of noise
    politics: 50000,    // High stakes, well-funded
    war: 40000,         // Sensitive, medium activity
    sports: 30000,      // Variable, often lower liq
    esports: 20000,     // Niche, emerging
    popculture: 20000,  // Niche, trendy
    entertainment: 20000,
    science: 25000,
    other: 25000,       // Default for uncategorized
};

// Minimum threshold for breakout/emerging market detection
const EMERGING_MARKET_MIN_LIQ = 10000;

interface CLOBToken {
    token_id: string;
    outcome: string;
    price: string;
}

interface CLOBMarket {
    condition_id: string;
    question_id: string;
    tokens: CLOBToken[];
    market_slug: string;
    active: boolean;
}

/**
 * Fetches active market asset IDs from Polymarket APIs
 */
export class MarketFetcher {
    private readonly gammaApiUrl = 'https://gamma-api.polymarket.com/markets';
    private readonly clobApiUrl: string;

    constructor() {
        this.clobApiUrl = config.polymarket.apiUrl;
    }

    /**
     * Get active asset IDs for target categories
     */
    async getActiveAssetIds(limit: number = 50): Promise<string[]> {
        try {
            console.log('[MarketFetcher] Fetching active markets...');
            const marketLimit = 5000;
            const minLiquidity = 25000;
            const markets = await this.fetchActiveMarkets(marketLimit, minLiquidity);

            // Extract asset IDs from clobTokenIds
            const assetIds: string[] = [];

            for (const market of markets) {
                if (market.clobTokenIds) {
                    try {
                        const tokenIds = JSON.parse(market.clobTokenIds) as string[];
                        assetIds.push(...tokenIds);
                    } catch {
                        // Skip malformed JSON
                    }
                }
            }

            console.log(`[MarketFetcher] Found ${assetIds.length} asset IDs from ${markets.length} markets`);
            return assetIds;
        } catch (error) {
            console.error('[MarketFetcher] Error fetching markets:', error);
            return [];
        }
    }

    /**
     * Get asset IDs for specific categories (geopolitics, war, crypto)
     */
    async getTargetCategoryAssetIds(): Promise<string[]> {
        try {
            // Lowered threshold to catch emerging markets (was $50k, now $10k)
            const marketLimit = 5000;
            const minLiquidity = 10000;
            const allMarkets = await this.fetchActiveMarkets(marketLimit, minLiquidity);

            // Filter by category keywords
            const targetMarkets = allMarkets.filter(market => {
                const text = market.question.toLowerCase();
                return this.matchesTargetCategory(text);
            });

            console.log(`[MarketFetcher] ${targetMarkets.length} markets match target categories`);

            const assetIds: string[] = [];
            for (const market of targetMarkets) {
                if (market.clobTokenIds) {
                    try {
                        const tokenIds = JSON.parse(market.clobTokenIds) as string[];
                        assetIds.push(...tokenIds);
                    } catch {
                        // Skip malformed
                    }
                }
            }

            return assetIds;
        } catch (error) {
            console.error('[MarketFetcher] Error fetching target markets:', error);
            return [];
        }
    }

    /**
     * Fetch emerging/breakout markets with lower liquidity threshold
     * Used for 30-min discovery loops to catch early insider activity
     * Returns markets with liq > $10k that don't meet normal thresholds
     */
    async fetchEmergingMarkets(): Promise<GammaMarket[]> {
        try {
            console.log('[MarketFetcher] Scanning for emerging/breakout markets...');

            // Fetch a broad set with very low threshold
            const markets = await this.fetchActiveMarkets(2000, EMERGING_MARKET_MIN_LIQ);

            // Filter to only those BELOW normal thresholds but showing activity
            const emergingMarkets = markets.filter(m => {
                const liq = parseFloat(m.liquidity || '0');
                const volume = parseFloat(m.volume || '0');
                const categoryThreshold = this.getLiquidityThreshold(m.question);

                // Include if:
                // 1. Below normal category threshold (would be filtered out normally)
                // 2. BUT has some meaningful activity (volume > $5k)
                const isBelowNormalThreshold = liq < categoryThreshold;
                const hasActivity = volume > 5000;

                return isBelowNormalThreshold && hasActivity && liq >= EMERGING_MARKET_MIN_LIQ;
            });

            if (emergingMarkets.length > 0) {
                console.log(`[MarketFetcher] 🚀 Found ${emergingMarkets.length} emerging markets (liq $10k-$50k range)`);
            }

            return emergingMarkets;
        } catch (error) {
            console.error('[MarketFetcher] Error fetching emerging markets:', error);
            return [];
        }
    }

    /**
     * Check if market matches target categories and return category name
     * Returns null if no match, otherwise returns the category
     */
    private detectCategory(text: string): string | null {
        const keywords: Record<string, string[]> = {
            crypto: [
                'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'token',
                'sec', 'binance', 'coinbase', 'solana', 'etf', 'halving',
                'regulation', 'stablecoin', 'defi', 'nft',
            ],
            politics: [
                'election', 'president', 'prime minister', 'vote', 'trump', 'biden',
                'congress', 'senate', 'democrat', 'republican', 'government',
                'maduro', 'putin', 'xi', 'regime', 'impeach', 'nomination',
            ],
            war: [
                'war', 'military', 'invasion', 'attack', 'strike', 'ukraine',
                'russia', 'israel', 'hamas', 'iran', 'nato', 'ceasefire',
                'troops', 'missile', 'nuclear', 'conflict', 'gaza',
            ],
            sports: [
                'nfl', 'nba', 'mlb', 'nhl', 'super bowl', 'world series',
                'championship', 'playoffs', 'finals', 'soccer', 'football',
            ],
            esports: [
                'esports', 'league of legends', 'dota', 'csgo', 'valorant',
                'twitch', 'streamer', 'gaming', 'tournament',
            ],
            popculture: [
                'celebrity', 'movie', 'oscar', 'grammy', 'emmy', 'album',
                'musk', 'kardashian', 'taylor swift', 'viral', 'tiktok',
            ],
            entertainment: [
                'netflix', 'disney', 'hbo', 'streaming', 'box office',
                'concert', 'tour', 'album', 'release',
            ],
            science: [
                'spacex', 'nasa', 'rocket', 'launch', 'mars', 'moon',
                'ai', 'openai', 'gpt', 'anthropic', 'climate', 'fda',
            ],
        };

        for (const [category, categoryKeywords] of Object.entries(keywords)) {
            for (const keyword of categoryKeywords) {
                if (text.includes(keyword)) {
                    return category;
                }
            }
        }
        return null;
    }

    /**
     * Backward compatibility wrapper
     */
    private matchesTargetCategory(text: string): boolean {
        return this.detectCategory(text) !== null;
    }

    /**
     * Get liquidity threshold for a market based on its category
     */
    private getLiquidityThreshold(question: string): number {
        const category = this.detectCategory(question.toLowerCase());
        if (category && CATEGORY_LIQUIDITY_THRESHOLDS[category]) {
            return CATEGORY_LIQUIDITY_THRESHOLDS[category];
        }
        return CATEGORY_LIQUIDITY_THRESHOLDS.other;
    }

    /**
     * Fetch top active markets sorted by volume (Capped by count)
     * Limit prevents over-subscribing (e.g. < 15k markets)
     */
    async fetchActiveMarkets(limit: number = 2000, minLiquidity: number = 10000): Promise<GammaMarket[]> {
        const pageSize = 100;
        let offset = 0;
        const allMarkets: GammaMarket[] = [];
        let running = true;

        console.log(`[MarketFetcher] fetching top ${limit} markets (liq > $${minLiquidity})...`);

        while (running && allMarkets.length < limit) {
            try {
                // Adjust limit for last page to not over-fetch significantly
                // But simplified: just fetch pages and slice later or stop loop
                const markets = await this.fetchGammaMarkets(pageSize, offset);

                // Smart Filter: category-based liquidity thresholds
                // Allows lower-liq niche markets (esports, popculture) while strict on crypto/politics
                const validMarkets = markets.filter(m => {
                    const liq = parseFloat(m.liquidity || '0');
                    const categoryThreshold = this.getLiquidityThreshold(m.question);

                    // Use the more permissive of: category threshold or passed minLiquidity
                    // This allows niche markets at $20k even if default is $50k
                    const effectiveThreshold = Math.min(categoryThreshold, minLiquidity);

                    return liq >= effectiveThreshold;
                });

                allMarkets.push(...validMarkets);
                console.log(`[MarketFetcher] Batch: ${markets.length}, Valid: ${validMarkets.length}. Total: ${allMarkets.length}/${limit}`);

                if (markets.length < pageSize || allMarkets.length >= limit) {
                    running = false;
                } else {
                    offset += pageSize;
                    if (offset >= 10000) {
                        running = false;
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            } catch (error) {
                console.error(`[MarketFetcher] Error fetching page at offset ${offset}:`, error);
                running = false;
            }
        }

        // Return exactly the limit or less
        return allMarkets.slice(0, limit);
    }

    /**
     * Fetch markets from Gamma API with pagination
     */
    private async fetchGammaMarkets(limit: number, offset: number = 0): Promise<GammaMarket[]> {
        const url = new URL(this.gammaApiUrl);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));
        url.searchParams.set('active', 'true');
        url.searchParams.set('closed', 'false');
        url.searchParams.set('order', 'volume');
        url.searchParams.set('ascending', 'false');

        const response = await fetch(url.toString());

        if (!response.ok) {
            throw new Error(`Gamma API error: ${response.status}`);
        }

        const data = await response.json();

        // API returns array directly
        if (Array.isArray(data)) {
            return data as GammaMarket[];
        }

        return [];
    }

    /**
     * Fetch markets from CLOB API
     */
    async fetchCLOBMarkets(limit: number = 50): Promise<CLOBMarket[]> {
        try {
            const response = await fetch(`${this.clobApiUrl}/markets?limit=${limit}`);

            if (!response.ok) {
                throw new Error(`CLOB API error: ${response.status}`);
            }

            const data = await response.json();
            return (data as CLOBMarket[]) || [];
        } catch (error) {
            console.error('[MarketFetcher] CLOB fetch error:', error);
            return [];
        }
    }

    /**
     * Get sample asset IDs for testing (known active markets)
     */
    getSampleAssetIds(): string[] {
        // These are sample token IDs from active Polymarket markets
        // In production, these would be fetched dynamically
        return [
            // You can add known token IDs here for testing
        ];
    }
}
