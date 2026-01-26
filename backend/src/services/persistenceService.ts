import { Trade, Wallet, Market, isMongoDBConnected } from '../db/index.js';
import { EnrichedTrade } from '../types/index.js';

/**
 * Persistence service for storing trades, wallets, and markets in MongoDB
 * Gracefully handles disconnection - operations become no-ops when DB is unavailable
 */
export class PersistenceService {
    /**
     * Save an enriched trade to MongoDB
     */
    async saveTrade(trade: EnrichedTrade): Promise<void> {
        if (!isMongoDBConnected()) {
            return; // Graceful degradation
        }

        // Check if we have a valid wallet address
        const hasWallet = trade.walletAddress && trade.walletAddress.trim() !== '';

        try {
            await Trade.findOneAndUpdate(
                { tradeId: trade.id },
                {
                    $set: {
                        tradeId: trade.id,
                        walletAddress: trade.walletAddress,
                        marketId: trade.marketId,
                        marketTitle: trade.marketTitle,
                        marketCategory: trade.marketCategory,
                        side: trade.side,
                        price: trade.price,
                        sizeUsd: trade.sizeUsd,
                        timestamp: trade.timestamp,
                        insiderScore: {
                            total: trade.insiderScore.breakdown.total,
                            breakdown: trade.insiderScore.breakdown,
                            isFlagged: trade.insiderScore.isFlagged,
                            confidence: trade.insiderScore.confidence,
                        },
                        marketResolved: false,
                        marketOutcome: null,
                        tradeWon: null,
                        pnl: null,
                    },
                },
                { upsert: true, new: true }
            );

            // Update wallet aggregate stats (only if we have a wallet)
            if (hasWallet) {
                await this.updateWalletStats(trade);
            }

            // Ensure market exists
            await this.ensureMarket(trade);

            console.log(`[Persistence] Saved trade ${trade.id.slice(0, 8)}...`);
        } catch (error) {
            console.error('[Persistence] Failed to save trade:', error);
        }
    }

    /**
     * Update wallet aggregate statistics (atomic upsert to prevent race conditions)
     */
    private async updateWalletStats(trade: EnrichedTrade): Promise<void> {
        try {
            const isFlagged = trade.insiderScore.isFlagged;

            // Use atomic findOneAndUpdate with upsert to prevent race conditions
            // When two trades for same wallet come in simultaneously, both will succeed
            await Wallet.findOneAndUpdate(
                { address: trade.walletAddress },
                {
                    $inc: {
                        totalTrades: 1,
                        flaggedTrades: isFlagged ? 1 : 0,
                    },
                    $set: {
                        lastActive: new Date(),
                    },
                    $setOnInsert: {
                        address: trade.walletAddress,
                        avgInsiderScore: trade.insiderScore.breakdown.total,
                        firstSeen: new Date(),
                    },
                    $addToSet: {
                        tags: {
                            $each: isFlagged ? ['whale', 'insider-flagged'] : ['whale']
                        },
                    },
                },
                { upsert: true }
            );

            // Update average insider score separately (can't use $inc with calculated value)
            // This is a minor optimization - the score will be slightly lagged but accurate
            const wallet = await Wallet.findOne({ address: trade.walletAddress });
            if (wallet && wallet.totalTrades > 1) {
                const newAvgScore =
                    (wallet.avgInsiderScore * (wallet.totalTrades - 1) + trade.insiderScore.breakdown.total) /
                    wallet.totalTrades;
                await Wallet.updateOne(
                    { address: trade.walletAddress },
                    { $set: { avgInsiderScore: newAvgScore } }
                );
            }
        } catch (error) {
            console.error('[Persistence] Failed to update wallet stats:', error);
        }
    }

    /**
     * Ensure market document exists
     */
    private async ensureMarket(trade: EnrichedTrade): Promise<void> {
        try {
            await Market.findOneAndUpdate(
                { marketId: trade.marketId },
                {
                    $setOnInsert: {
                        marketId: trade.marketId,
                        title: trade.marketTitle,
                        category: trade.marketCategory,
                        endDate: trade.marketEndDate || null,
                        resolved: false,
                        outcome: null,
                        resolvedAt: null,
                    },
                    $inc: {
                        tradeCount: 1,
                        flaggedTradeCount: trade.insiderScore.isFlagged ? 1 : 0,
                    },
                },
                { upsert: true }
            );
        } catch (error) {
            console.error('[Persistence] Failed to ensure market:', error);
        }
    }

    /**
     * Get recent trades for a wallet
     */
    async getWalletTrades(
        walletAddress: string,
        limit: number = 50
    ): Promise<any[]> {
        if (!isMongoDBConnected()) {
            return [];
        }

        try {
            return await Trade.find({ walletAddress })
                .sort({ timestamp: -1 })
                .limit(limit)
                .lean();
        } catch (error) {
            console.error('[Persistence] Failed to get wallet trades:', error);
            return [];
        }
    }

    /**
     * Get unresolved markets for outcome polling
     */
    async getUnresolvedMarkets(): Promise<Array<{ marketId: string; endDate: Date | null }>> {
        if (!isMongoDBConnected()) {
            return [];
        }

        try {
            return await Market.find({ resolved: false })
                .select('marketId endDate')
                .lean();
        } catch (error) {
            console.error('[Persistence] Failed to get unresolved markets:', error);
            return [];
        }
    }

    /**
     * Get database statistics
     */
    async getStats(): Promise<{
        totalTrades: number;
        flaggedTrades: number;
        totalWallets: number;
        resolvedMarkets: number;
    }> {
        if (!isMongoDBConnected()) {
            return { totalTrades: 0, flaggedTrades: 0, totalWallets: 0, resolvedMarkets: 0 };
        }

        try {
            const [totalTrades, flaggedTrades, totalWallets, resolvedMarkets] = await Promise.all([
                Trade.countDocuments(),
                Trade.countDocuments({ 'insiderScore.isFlagged': true }),
                Wallet.countDocuments(),
                Market.countDocuments({ resolved: true }),
            ]);

            return { totalTrades, flaggedTrades, totalWallets, resolvedMarkets };
        } catch (error) {
            console.error('[Persistence] Failed to get stats:', error);
            return { totalTrades: 0, flaggedTrades: 0, totalWallets: 0, resolvedMarkets: 0 };
        }
    }
}
