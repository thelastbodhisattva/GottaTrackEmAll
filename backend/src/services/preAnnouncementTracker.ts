import { Trade as TradeMongo, isMongoDBConnected } from '../db/index.js';
import { Trade as TradeType } from '../types/index.js';

/**
 * PreAnnouncementTracker - Monitors price movements after trades
 * 
 * Detects if market price moved significantly (>10%) within 1-2 hours after a trade.
 * This is a strong indicator the trader had foreknowledge of upcoming news/events.
 * 
 * Scoring:
 * - 15%+ move within 1 hour: 10 pts
 * - 10-15% move within 1 hour: 7 pts  
 * - 5-10% move within 1 hour: 3 pts
 */
export class PreAnnouncementTracker {
    private pendingChecks = new Map<string, {
        tradeId: string;
        marketId: string;
        priceAtTrade: number;
        side: 'YES' | 'NO';
        timestamp: number;
        walletAddress: string;
    }>();

    private checkIntervalMs = 60 * 60 * 1000; // Check every hour
    private maxPendingAge = 2 * 60 * 60 * 1000; // Remove after 2 hours

    /**
     * Record a trade for post-trade price monitoring
     */
    recordTrade(trade: TradeType): void {
        if (!trade.marketId || !trade.side || !trade.price) return;

        this.pendingChecks.set(trade.id, {
            tradeId: trade.id,
            marketId: trade.marketId,
            priceAtTrade: trade.price,
            side: trade.side,
            timestamp: trade.timestamp.getTime(),
            walletAddress: trade.walletAddress,
        });

        console.log(`[PreAnnouncementTracker] Tracking ${trade.id.slice(0, 8)}... for post-trade price monitoring`);
    }

    /**
     * Record an enriched trade (from main app) for post-trade price monitoring
     * Only tracks flagged trades to reduce overhead
     */
    recordEnrichedTrade(trade: {
        id: string;
        marketId: string;
        side: 'YES' | 'NO';
        price: number;
        timestamp: Date;
        walletAddress: string;
        isFlagged: boolean;
    }): void {
        // Only track flagged trades (potential insiders)
        if (!trade.isFlagged) return;
        if (!trade.marketId || !trade.side || !trade.price) return;

        this.pendingChecks.set(trade.id, {
            tradeId: trade.id,
            marketId: trade.marketId,
            priceAtTrade: trade.price,
            side: trade.side,
            timestamp: trade.timestamp.getTime(),
            walletAddress: trade.walletAddress,
        });

        console.log(`[PreAnnouncementTracker] 🎯 Tracking flagged trade ${trade.id.slice(0, 8)}... for post-trade price monitoring`);
    }

    /**
     * Check for price movements and calculate pre-announcement scores
     * Called periodically (e.g., every 15 minutes)
     */
    async checkPriceMovements(getCurrentPrice: (marketId: string) => Promise<number | null>): Promise<void> {
        const now = Date.now();
        const scored: string[] = [];

        for (const [tradeId, pending] of this.pendingChecks.entries()) {
            const ageMs = now - pending.timestamp;

            // Skip if less than 1 hour old
            if (ageMs < this.checkIntervalMs) continue;

            // Remove if too old
            if (ageMs > this.maxPendingAge) {
                this.pendingChecks.delete(tradeId);
                continue;
            }

            try {
                const currentPrice = await getCurrentPrice(pending.marketId);
                if (currentPrice === null) continue;

                // Calculate price movement in the direction of the trade
                let priceMove = 0;
                if (pending.side === 'YES') {
                    priceMove = currentPrice - pending.priceAtTrade;
                } else {
                    priceMove = pending.priceAtTrade - currentPrice; // NO wins if price drops
                }

                const percentMove = Math.abs(priceMove);

                if (percentMove >= 0.05) { // 5% or more
                    const score = this.calculateScore(percentMove);

                    console.log(`[PreAnnouncementTracker] 📈 Price move detected for ${tradeId.slice(0, 8)}...:`);
                    console.log(`  Price at trade: ${(pending.priceAtTrade * 100).toFixed(1)}%`);
                    console.log(`  Current price: ${(currentPrice * 100).toFixed(1)}%`);
                    console.log(`  Move: ${(priceMove * 100).toFixed(1)}% (${pending.side})`);
                    console.log(`  Pre-announcement score: +${score} pts`);

                    // Update trade in MongoDB if connected
                    if (isMongoDBConnected()) {
                        await TradeMongo.updateOne(
                            { id: tradeId },
                            {
                                $set: {
                                    preAnnouncementScore: score,
                                    priceAfter1h: currentPrice,
                                    priceMovePercent: percentMove,
                                }
                            }
                        );
                    }
                }

                scored.push(tradeId);
            } catch (error) {
                console.error(`[PreAnnouncementTracker] Error checking ${tradeId}:`, error);
            }
        }

        // Remove checked trades
        for (const id of scored) {
            this.pendingChecks.delete(id);
        }

        if (scored.length > 0) {
            console.log(`[PreAnnouncementTracker] Checked ${scored.length} trades, ${this.pendingChecks.size} still pending`);
        }
    }

    /**
     * Calculate pre-announcement score based on price movement
     */
    private calculateScore(percentMove: number): number {
        if (percentMove >= 0.15) return 10;  // 15%+ move = maximum score
        if (percentMove >= 0.10) return 7;   // 10-15% move
        if (percentMove >= 0.05) return 3;   // 5-10% move
        return 0;
    }

    /**
     * Get pending check count
     */
    getPendingCount(): number {
        return this.pendingChecks.size;
    }

    /**
     * Clear old pending checks
     */
    cleanup(): void {
        const now = Date.now();
        for (const [tradeId, pending] of this.pendingChecks.entries()) {
            if (now - pending.timestamp > this.maxPendingAge) {
                this.pendingChecks.delete(tradeId);
            }
        }
        // Also cleanup old price history
        for (const [marketId, history] of this.priceHistory.entries()) {
            const recentHistory = history.filter(h => now - h.timestamp < 2 * 60 * 60 * 1000);
            if (recentHistory.length === 0) {
                this.priceHistory.delete(marketId);
            } else {
                this.priceHistory.set(marketId, recentHistory);
            }
        }
    }

    // =========================================================================
    // Pre-Odds-Shift Detection (Batch 2 Feature)
    // =========================================================================

    // Track recent price snapshots for markets (updated when trades come in)
    private priceHistory = new Map<string, Array<{ price: number; timestamp: number }>>();

    /**
     * Record a price snapshot (call for every trade processed)
     */
    recordPriceSnapshot(marketId: string, price: number): void {
        if (!marketId || !price || price <= 0 || price >= 1) return;

        const history = this.priceHistory.get(marketId) || [];
        history.push({ price, timestamp: Date.now() });

        // Keep only last 2 hours of history (24 snapshots at 5-min intervals max)
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        const recentHistory = history.filter(h => h.timestamp > twoHoursAgo);
        this.priceHistory.set(marketId, recentHistory.slice(-30)); // Max 30 snapshots
    }

    /**
     * Detect if odds shifted significantly before a trade
     * Returns bonus points: 0-10 based on magnitude of pre-trade shift
     * 
     * Logic: If price moved >5% in the 30-60 min BEFORE this trade,
     * and the trade is betting in the direction of the move,
     * trader might have been "front-running" their own info.
     */
    detectPreOddsShift(marketId: string, tradePrice: number, tradeSide: 'YES' | 'NO'): number {
        const history = this.priceHistory.get(marketId);
        if (!history || history.length < 2) return 0;

        const now = Date.now();

        // Find price from 30-60 min ago
        const thirtyMinAgo = now - 30 * 60 * 1000;
        const sixtyMinAgo = now - 60 * 60 * 1000;

        const oldPrices = history.filter(h =>
            h.timestamp >= sixtyMinAgo && h.timestamp <= thirtyMinAgo
        );

        if (oldPrices.length === 0) return 0;

        // Get average price from 30-60 min ago
        const avgOldPrice = oldPrices.reduce((sum, h) => sum + h.price, 0) / oldPrices.length;

        // Calculate price movement
        const priceMove = tradePrice - avgOldPrice;
        const percentMove = Math.abs(priceMove);

        // Check if trade is in same direction as the move
        const moveFavorsYes = priceMove > 0;
        const tradeIsYes = tradeSide === 'YES';
        const tradeFollowsMove = (moveFavorsYes && tradeIsYes) || (!moveFavorsYes && !tradeIsYes);

        // Only flag if trade follows the direction of recent move
        if (!tradeFollowsMove) return 0;

        // Score based on magnitude
        if (percentMove >= 0.15) {
            console.log(`[PreAnnouncementTracker] 📉 Major pre-trade odds shift: ${(percentMove * 100).toFixed(1)}% move before ${tradeSide} bet (+10)`);
            return 10;
        }
        if (percentMove >= 0.10) {
            console.log(`[PreAnnouncementTracker] 📉 Significant pre-trade odds shift: ${(percentMove * 100).toFixed(1)}% move before ${tradeSide} bet (+7)`);
            return 7;
        }
        if (percentMove >= 0.05) {
            console.log(`[PreAnnouncementTracker] 📉 Notable pre-trade odds shift: ${(percentMove * 100).toFixed(1)}% move before ${tradeSide} bet (+3)`);
            return 3;
        }

        return 0;
    }
}
