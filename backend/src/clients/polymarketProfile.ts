import { WalletProfile } from '../types/index.js';

/**
 * Client for fetching wallet profile data from Polymarket Data API
 */
export class PolymarketProfileClient {
    private readonly baseUrl = 'https://data-api.polymarket.com';
    private cache = new Map<string, { profile: WalletProfile; fetchedAt: number }>();
    private cacheMaxAge = 5 * 60 * 1000; // 5 minutes

    /**
     * Fetch wallet profile (positions, PnL, stats) from Polymarket
     */
    async getWalletProfile(address: string): Promise<WalletProfile | null> {
        // Skip invalid addresses
        if (!address || address === 'Unknown' || !address.startsWith('0x')) {
            return null;
        }

        // Check cache first
        const cached = this.cache.get(address.toLowerCase());
        if (cached && Date.now() - cached.fetchedAt < this.cacheMaxAge) {
            return cached.profile;
        }

        try {
            // Fetch positions from Data API
            const positionsUrl = `${this.baseUrl}/positions?user=${address}`;
            const positionsResponse = await fetch(positionsUrl);

            if (!positionsResponse.ok) {
                console.warn(`[PolymarketProfile] Positions API returned ${positionsResponse.status} for ${address.slice(0, 10)}...`);
                return null;
            }

            const positions = await positionsResponse.json();

            // Calculate stats from positions
            let totalTrades = 0;
            let totalPnl = 0;
            let totalVolume = 0;
            let wins = 0;
            const marketsTraded: { id: string; title?: string; category?: string }[] = [];
            const seenMarkets = new Set<string>();

            if (Array.isArray(positions)) {
                for (const pos of positions) {
                    const pnl = parseFloat(pos.cashPnl || pos.pnl || '0');
                    const value = parseFloat(pos.value || pos.size || pos.initialValue || '0');
                    totalPnl += pnl;
                    totalVolume += Math.abs(value);
                    totalTrades++;

                    if (pnl > 0) {
                        wins++;
                    }

                    const marketId = pos.market || pos.conditionId;
                    if (marketId && !seenMarkets.has(marketId)) {
                        seenMarkets.add(marketId);
                        // Extract title and category from position data
                        const title = pos.title || pos.question || pos.marketTitle || '';
                        const category = pos.category || pos.marketCategory || this.inferCategory(title);
                        marketsTraded.push({ id: marketId, title, category });
                    }
                }
            }

            const winRate = totalTrades > 0 ? wins / totalTrades : 0;

            // Calculate average trade size from position values (not PnL)
            const avgTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0;

            const profile: WalletProfile = {
                address: address.toLowerCase(),
                totalTrades,
                totalPnl,
                winRate,
                avgTradeSize,
                marketsTraded,
                firstSeen: new Date(),
                lastActive: new Date(),
                tags: [],
            };

            // Cache the result
            this.cache.set(address.toLowerCase(), {
                profile,
                fetchedAt: Date.now(),
            });

            console.log(`[PolymarketProfile] Fetched profile for ${address.slice(0, 10)}...: ${totalTrades} trades, $${totalPnl.toFixed(2)} PnL`);

            return profile;
        } catch (error) {
            console.error(`[PolymarketProfile] Error fetching profile for ${address.slice(0, 10)}...:`, error);
            return null;
        }
    }

    /**
     * Get from leaderboard API for more detailed stats
     */
    async getLeaderboardEntry(address: string): Promise<{
        pnl: number;
        volume: number;
        rank: number;
    } | null> {
        try {
            const url = `${this.baseUrl}/v1/leaderboard?address=${address}`;
            const response = await fetch(url);

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                return {
                    pnl: parseFloat(data[0].pnl || '0'),
                    volume: parseFloat(data[0].volume || '0'),
                    rank: data[0].rank || 0,
                };
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Get wallet's recent trading activity for noise detection and order flow analysis
     */
    async getWalletActivity(address: string, limit: number = 50): Promise<{
        trades: Array<{
            size: number;
            price: number;
            side: string;
            market: string;
            timestamp: Date;
        }>;
        noiseTradeRatio: number;
        hasWashTrading: boolean;
        totalVolume: number;
        maxSingleTradeRatio: number;
    } | null> {
        if (!address || address === 'Unknown' || !address.startsWith('0x')) {
            return null;
        }

        try {
            const url = `${this.baseUrl}/activity?user=${address}&limit=${limit}`;
            const response = await fetch(url);

            if (!response.ok) {
                return null;
            }

            const data = await response.json() as any[];
            const trades: Array<{
                size: number;
                price: number;
                side: string;
                market: string;
                timestamp: Date;
            }> = [];

            let noiseCount = 0;
            let washTradingDetected = false;
            const recentMarketActions = new Map<string, { buys: number; sells: number; lastAction: string; lastTime: number }>();

            for (const item of data || []) {
                const size = parseFloat(item.size || item.value || '0');
                const price = parseFloat(item.price || '0');

                trades.push({
                    size,
                    price,
                    side: item.side || item.type || 'unknown',
                    market: item.market || item.conditionId || '',
                    timestamp: new Date(item.timestamp || item.createdAt || Date.now()),
                });

                // Noise detection: tiny bets (<$100) or near-certain markets (>95% or <5%)
                const isNoiseBet = size < 100 || price > 0.95 || price < 0.05;
                if (isNoiseBet) {
                    noiseCount++;
                }

                // Wash trading detection: quick buy/sell on same market
                const marketKey = item.market || item.conditionId || '';
                const side = (item.side || '').toLowerCase();
                const timestamp = new Date(item.timestamp || Date.now()).getTime();

                if (marketKey) {
                    const existing = recentMarketActions.get(marketKey);
                    if (existing) {
                        // Check for opposite action within 1 hour
                        const timeDiff = Math.abs(timestamp - existing.lastTime);
                        if (timeDiff < 3600000) { // 1 hour
                            if ((side === 'buy' && existing.lastAction === 'sell') ||
                                (side === 'sell' && existing.lastAction === 'buy')) {
                                washTradingDetected = true;
                            }
                        }
                        if (side === 'buy') existing.buys++;
                        else if (side === 'sell') existing.sells++;
                        existing.lastAction = side;
                        existing.lastTime = timestamp;
                    } else {
                        recentMarketActions.set(marketKey, {
                            buys: side === 'buy' ? 1 : 0,
                            sells: side === 'sell' ? 1 : 0,
                            lastAction: side,
                            lastTime: timestamp,
                        });
                    }
                }
            }

            const noiseTradeRatio = trades.length > 0 ? noiseCount / trades.length : 0;

            // Volume concentration metrics
            const totalVolume = trades.reduce((sum, t) => sum + t.size, 0);
            const maxTrade = trades.length > 0 ? Math.max(...trades.map(t => t.size)) : 0;
            const maxSingleTradeRatio = totalVolume > 0 ? maxTrade / totalVolume : 0;

            return {
                trades,
                noiseTradeRatio,
                hasWashTrading: washTradingDetected,
                totalVolume,
                maxSingleTradeRatio,
            };
        } catch (error) {
            console.error(`[PolymarketProfile] Error fetching activity:`, error);
            return null;
        }
    }

    /**
     * Infer market category from title text
     */
    private inferCategory(title: string): string | undefined {
        const text = title.toLowerCase();

        // Geopolitics
        if (/election|president|vote|congress|senate|trump|biden|democrat|republican|parliament|government/.test(text)) {
            return 'geopolitics';
        }

        // War/Conflict
        if (/war|military|attack|ukraine|russia|israel|hamas|iran|nato|missile|strike|ceasefire/.test(text)) {
            return 'war';
        }

        // Crypto
        if (/bitcoin|btc|ethereum|eth|crypto|token|blockchain|defi|nft|binance|coinbase|solana|xrp/.test(text)) {
            return 'crypto';
        }

        return undefined;
    }

    /**
     * Clear cache (for testing)
     */
    clearCache(): void {
        this.cache.clear();
    }
}
