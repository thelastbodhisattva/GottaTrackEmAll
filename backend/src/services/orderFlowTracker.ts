import { Trade } from '../types/index.js';

/**
 * Trade record for order flow analysis
 */
interface TradeRecord {
    id: string;
    walletAddress: string;
    marketId: string;
    side: 'YES' | 'NO';
    sizeUsd: number;
    price: number;
    timestamp: number;
}

/**
 * Order flow pattern analysis result
 */
export interface OrderFlowScore {
    score: number;           // 0-15 points (upgraded)
    hasAccumulation: boolean;
    hasClusteredActivity: boolean;
    hasMomentum: boolean;
    hasBatchTrading: boolean;
    details: string;
}

/**
 * OrderFlowTracker - Tracks and analyzes trade patterns for insider detection
 * 
 * Detects:
 * - Accumulation patterns (same wallet buying repeatedly)
 * - Clustered activity (multiple large trades in short window)
 * - Price momentum (large trades followed by price movement)
 * - Coordinated buying (multiple wallets buying same side)
 */
export class OrderFlowTracker {
    private recentTrades = new Map<string, TradeRecord[]>(); // marketId -> trades
    private maxTradesPerMarket = 100;
    private maxMarkets = 500; // Limit total markets tracked to prevent unbounded growth
    private analysisWindowMs = 30 * 60 * 1000; // 30 minutes
    private recentLogs = new Map<string, number>(); // Log deduplication: key -> timestamp
    private logDedupeWindowMs = 5 * 60 * 1000; // Don't repeat same log within 5 minutes

    /**
     * Record a new trade for pattern analysis
     */
    recordTrade(trade: Trade): void {
        const record: TradeRecord = {
            id: trade.id,
            walletAddress: trade.walletAddress,
            marketId: trade.marketId,
            side: trade.side,
            sizeUsd: trade.sizeUsd,
            price: trade.price,
            timestamp: trade.timestamp.getTime(),
        };

        const existing = this.recentTrades.get(trade.marketId) || [];
        existing.push(record);

        // Keep only recent trades
        const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour
        const filtered = existing.filter(t => t.timestamp > cutoff).slice(-this.maxTradesPerMarket);
        this.recentTrades.set(trade.marketId, filtered);

        // Memory protection: If exceeding max markets, evict oldest markets
        if (this.recentTrades.size > this.maxMarkets) {
            this.evictOldestMarkets();
        }
    }

    /**
     * Evict markets with oldest trades to stay within memory limits
     */
    private evictOldestMarkets(): void {
        // Find markets to evict (those with oldest last trade)
        const marketsByAge: { marketId: string; lastTrade: number }[] = [];

        for (const [marketId, trades] of this.recentTrades.entries()) {
            const lastTrade = trades.length > 0
                ? Math.max(...trades.map(t => t.timestamp))
                : 0;
            marketsByAge.push({ marketId, lastTrade });
        }

        // Sort by oldest first
        marketsByAge.sort((a, b) => a.lastTrade - b.lastTrade);

        // Evict oldest 10% to create headroom
        const evictCount = Math.ceil(this.maxMarkets * 0.1);
        for (let i = 0; i < evictCount && i < marketsByAge.length; i++) {
            this.recentTrades.delete(marketsByAge[i].marketId);
        }

        console.log(`[OrderFlowTracker] Memory cleanup: evicted ${evictCount} oldest markets, now tracking ${this.recentTrades.size}`);
    }


    /**
     * Analyze order flow patterns for a trade
     * Returns 0-10 points based on suspicious patterns
     */
    analyzePatterns(trade: Trade): OrderFlowScore {
        const marketTrades = this.recentTrades.get(trade.marketId) || [];
        const now = trade.timestamp.getTime();
        const windowStart = now - this.analysisWindowMs;

        // Get trades in analysis window (excluding current trade)
        const recentTrades = marketTrades.filter(t =>
            t.timestamp >= windowStart &&
            t.timestamp < now &&
            t.id !== trade.id
        );

        let score = 0;
        const details: string[] = [];

        // 1. Accumulation pattern detection (3 pts max)
        // Same wallet buying same side repeatedly
        const walletSameSideTrades = recentTrades.filter(t =>
            t.walletAddress === trade.walletAddress &&
            t.side === trade.side
        );
        const hasAccumulation = walletSameSideTrades.length >= 2;
        if (hasAccumulation) {
            const totalAccumulated = walletSameSideTrades.reduce((sum, t) => sum + t.sizeUsd, 0);
            score += Math.min(3, Math.floor(walletSameSideTrades.length));
            details.push(`Accumulation: ${walletSameSideTrades.length + 1} trades ($${totalAccumulated.toFixed(0)} + $${trade.sizeUsd.toFixed(0)})`);
        }

        // 2. Clustered large trade activity (4 pts max)
        // Multiple $10K+ trades in short window
        const largeTrades = recentTrades.filter(t => t.sizeUsd >= 10000);
        const hasClusteredActivity = largeTrades.length >= 3;
        if (largeTrades.length >= 5) {
            score += 4;
            details.push(`Heavy clustering: ${largeTrades.length} large trades in 30min`);
        } else if (largeTrades.length >= 3) {
            score += 2;
            details.push(`Clustering: ${largeTrades.length} large trades in 30min`);
        }

        // 3. Coordinated buying (3 pts max)
        // Multiple different wallets buying same side in short window
        const sameSideTrades = recentTrades.filter(t => t.side === trade.side);
        const uniqueWallets = new Set(sameSideTrades.map(t => t.walletAddress));
        const hasMomentum = uniqueWallets.size >= 3;
        if (uniqueWallets.size >= 5) {
            score += 3;
            details.push(`Coordinated: ${uniqueWallets.size} wallets buying ${trade.side}`);
        } else if (uniqueWallets.size >= 3) {
            score += 2;
            details.push(`Multiple wallets: ${uniqueWallets.size} on same side`);
        }

        // 4. Batch trading pattern (5 pts max) - NEW
        // Insiders split large bets into multiple smaller entries to avoid whale alerts
        // Check for same wallet, same side, multiple trades in short time totaling significant value
        const batchWindowMs = 60 * 60 * 1000; // 1 hour window
        const batchWindowStart = now - batchWindowMs;
        const walletBatchTrades = marketTrades.filter(t =>
            t.timestamp >= batchWindowStart &&
            t.walletAddress === trade.walletAddress &&
            t.side === trade.side
        );
        const batchTotalValue = walletBatchTrades.reduce((sum, t) => sum + t.sizeUsd, 0) + trade.sizeUsd;
        const hasBatchTrading = walletBatchTrades.length >= 2 && batchTotalValue >= 10000;

        if (walletBatchTrades.length >= 5 && batchTotalValue >= 10000) {
            score += 5;
            details.push(`Batch trading: ${walletBatchTrades.length + 1} trades totaling $${batchTotalValue.toFixed(0)}`);
        } else if (walletBatchTrades.length >= 2 && batchTotalValue >= 5000) {
            score += 3;
            details.push(`Split bets: ${walletBatchTrades.length + 1} trades totaling $${batchTotalValue.toFixed(0)}`);
        }

        // Cap at 15 (upgraded from 10 to accommodate batch trading)
        score = Math.min(15, score);

        const result: OrderFlowScore = {
            score,
            hasAccumulation,
            hasClusteredActivity,
            hasMomentum,
            hasBatchTrading,
            details: details.join('; ') || 'No significant patterns',
        };

        if (score >= 3) {
            // Deduplicate logs: only log if we haven't logged this wallet+market combo recently
            const logKey = `${trade.walletAddress}-${trade.marketId}`;
            const lastLog = this.recentLogs.get(logKey);
            const now = Date.now();

            if (!lastLog || (now - lastLog) > this.logDedupeWindowMs) {
                console.log(`[OrderFlowTracker] Pattern detected for ${trade.marketId.slice(0, 10)}...: ${result.details} (score: ${score})`);
                this.recentLogs.set(logKey, now);

                // Cleanup old log entries periodically
                if (this.recentLogs.size > 1000) {
                    for (const [key, timestamp] of this.recentLogs) {
                        if (now - timestamp > this.logDedupeWindowMs) {
                            this.recentLogs.delete(key);
                        }
                    }
                }
            }
        }

        return result;
    }

    /**
     * Get statistics for monitoring
     */
    getStats(): { marketsTracked: number; totalTrades: number } {
        let totalTrades = 0;
        for (const trades of this.recentTrades.values()) {
            totalTrades += trades.length;
        }
        return {
            marketsTracked: this.recentTrades.size,
            totalTrades,
        };
    }

    /**
     * Clear old data (call periodically)
     */
    cleanup(): void {
        const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour
        for (const [marketId, trades] of this.recentTrades.entries()) {
            const filtered = trades.filter(t => t.timestamp > cutoff);
            if (filtered.length === 0) {
                this.recentTrades.delete(marketId);
            } else {
                this.recentTrades.set(marketId, filtered);
            }
        }
    }
}
