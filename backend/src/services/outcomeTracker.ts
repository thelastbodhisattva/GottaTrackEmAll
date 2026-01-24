import { Trade, Market, Metrics, Wallet, isMongoDBConnected } from '../db/index.js';
import { LeaderboardEntry } from '../types/index.js';

/**
 * OutcomeTracker - Polls Polymarket API for resolved markets and calculates win rate validation
 * 
 * Key metrics:
 * - flaggedWinRate: Win rate of trades with isFlagged=true
 * - baselineWinRate: Win rate of trades with isFlagged=false
 * - lift: flaggedWinRate - baselineWinRate (should be positive if algorithm works)
 * 
 * Fast polling for short-duration crypto markets (BTC, ETH, SOL, etc.)
 */
export class OutcomeTracker {
    private pollInterval: NodeJS.Timeout | null = null;
    private fastPollInterval: NodeJS.Timeout | null = null;
    private readonly pollIntervalMs = 15 * 60 * 1000; // 15 minutes for regular markets
    private readonly fastPollIntervalMs = 2 * 60 * 1000; // 2 minutes for short-duration markets

    // Keywords for short-duration crypto markets
    private readonly shortDurationKeywords = [
        'btc', 'bitcoin', 'eth', 'ethereum', 'sol', 'solana',
        'xrp', 'doge', 'bnb', 'ada', 'avax', 'matic', 'link',
        '15 min', '15min', '30 min', '30min', '1 hour', '1hr', '1h',
        '2 hour', '2hr', '2h', '4 hour', '4hr', '4h',
        'up or down', 'above or below', 'price at',
    ];

    /**
     * Start periodic polling for resolved markets
     */
    startPolling(): void {
        if (this.pollInterval) {
            return; // Already running
        }

        console.log('[OutcomeTracker] Starting market resolution polling...');
        console.log('[OutcomeTracker] Fast poll (2min) for: BTC, ETH, SOL, XRP, DOGE, BNB, AVAX, MATIC, LINK + short durations');

        // Check if MongoDB is connected - PnL tracking requires it
        if (!isMongoDBConnected()) {
            console.warn('[OutcomeTracker] ⚠️ MongoDB not connected - PnL/Win Rate updates will NOT work!');
            console.warn('[OutcomeTracker] ⚠️ Start MongoDB with: docker-compose up -d mongo');
        }

        // Initial check
        this.checkResolvedMarkets().catch(console.error);
        this.checkShortDurationMarkets().catch(console.error);

        // Schedule regular market checks (every 15 min)
        this.pollInterval = setInterval(() => {
            this.checkResolvedMarkets().catch(console.error);
        }, this.pollIntervalMs);

        // Schedule fast polling for short-duration markets (every 2 min)
        this.fastPollInterval = setInterval(() => {
            this.checkShortDurationMarkets().catch(console.error);
        }, this.fastPollIntervalMs);
    }

    /**
     * Stop polling
     */
    stopPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        if (this.fastPollInterval) {
            clearInterval(this.fastPollInterval);
            this.fastPollInterval = null;
        }
        console.log('[OutcomeTracker] Stopped polling');
    }

    /**
     * Backfill all unresolved markets in the database
     * Call this once to retroactively fix markets that weren't resolved properly
     */
    async backfillUnresolvedMarkets(): Promise<{ checked: number; resolved: number; failed: number }> {
        if (!isMongoDBConnected()) {
            console.error('[OutcomeTracker] MongoDB not connected - cannot backfill');
            return { checked: 0, resolved: 0, failed: 0 };
        }

        console.log('[OutcomeTracker] 🔄 Starting backfill of all unresolved markets...');

        try {
            // Get ALL unresolved markets (no date filter)
            const unresolvedMarkets = await Market.find({ resolved: false });

            console.log(`[OutcomeTracker] Found ${unresolvedMarkets.length} unresolved markets to check`);

            let resolved = 0;
            let failed = 0;

            for (const market of unresolvedMarkets) {
                try {
                    // Add small delay to avoid rate limiting
                    await new Promise(r => setTimeout(r, 200));

                    const outcome = await this.fetchMarketOutcome(market.marketId);
                    if (outcome) {
                        await this.updateMarketOutcome(market.marketId, outcome);
                        resolved++;
                    }
                } catch (error) {
                    failed++;
                    console.error(`[OutcomeTracker] Failed to backfill market ${market.marketId.slice(0, 10)}...:`, error);
                }
            }

            // Update metrics after backfill
            await this.updateDailyMetrics();

            console.log(`[OutcomeTracker] ✅ Backfill complete: ${resolved}/${unresolvedMarkets.length} resolved, ${failed} failed`);
            return { checked: unresolvedMarkets.length, resolved, failed };
        } catch (error) {
            console.error('[OutcomeTracker] Failed to backfill markets:', error);
            return { checked: 0, resolved: 0, failed: 0 };
        }
    }

    /**
     * Check if a market title indicates a short-duration crypto market
     */
    private isShortDurationMarket(marketTitle: string): boolean {
        const title = marketTitle.toLowerCase();
        return this.shortDurationKeywords.some(keyword => title.includes(keyword));
    }

    /**
     * Fast check specifically for short-duration crypto markets
     */
    async checkShortDurationMarkets(): Promise<void> {
        if (!isMongoDBConnected()) {
            return;
        }

        try {
            // Find markets that:
            // 1. Are not resolved
            // 2. End within the next 2 hours (or already ended)
            const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);

            const shortDurationMarkets = await Market.find({
                resolved: false,
                endDate: { $lte: twoHoursFromNow }, // Ending soon or already ended
            }).limit(100);

            // Filter to only short-duration crypto markets
            const cryptoMarkets = shortDurationMarkets.filter(m =>
                this.isShortDurationMarket(m.title || m.marketId)
            );

            if (cryptoMarkets.length === 0) {
                return;
            }

            console.log(`[OutcomeTracker] ⚡ Fast-checking ${cryptoMarkets.length} short-duration crypto markets...`);

            for (const market of cryptoMarkets) {
                try {
                    const outcome = await this.fetchMarketOutcome(market.marketId);

                    if (outcome) {
                        await this.updateMarketOutcome(market.marketId, outcome);
                    }
                } catch (error) {
                    // Silent fail for fast polling - don't spam logs
                }
            }
        } catch (error) {
            console.error('[OutcomeTracker] Error in short-duration market check:', error);
        }
    }

    /**
     * Check for resolved markets and update trade outcomes
     */
    async checkResolvedMarkets(): Promise<void> {
        if (!isMongoDBConnected()) {
            return;
        }

        try {
            // Get unresolved markets that might have resolved
            const unresolvedMarkets = await Market.find({
                resolved: false,
                endDate: { $lte: new Date() }, // Past their end date
            }).limit(50);

            if (unresolvedMarkets.length === 0) {
                return;
            }

            console.log(`[OutcomeTracker] Checking ${unresolvedMarkets.length} markets for resolution...`);

            for (const market of unresolvedMarkets) {
                try {
                    const outcome = await this.fetchMarketOutcome(market.marketId);

                    if (outcome) {
                        await this.updateMarketOutcome(market.marketId, outcome);
                    }
                } catch (error) {
                    console.error(`[OutcomeTracker] Failed to check market ${market.marketId}:`, error);
                }
            }

            // Update daily metrics snapshot
            await this.updateDailyMetrics();
        } catch (error) {
            console.error('[OutcomeTracker] Failed to check resolved markets:', error);
        }
    }

    /**
     * Fetch market outcome from Polymarket Gamma API (has resolution data)
     * Note: CLOB API doesn't return resolution - must use Gamma API
     */
    private async fetchMarketOutcome(marketId: string): Promise<'YES' | 'NO' | null> {
        // Use Gamma API for resolution data (CLOB API doesn't have it)
        const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

        try {
            let market: any = null;

            // Try different query strategies to find the market
            const queryStrategies = [
                `${GAMMA_API_URL}/markets?clob_token_ids=${marketId}`,  // Most common: token ID
                `${GAMMA_API_URL}/markets?condition_id=${marketId}`,   // Some markets use condition ID
            ];

            for (const url of queryStrategies) {
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        const data = await response.json() as any;
                        if (Array.isArray(data) && data.length > 0) {
                            market = data[0];
                            break;
                        }
                    }
                } catch (e) {
                    // Try next strategy
                }
            }

            if (!market) {
                console.warn(`[OutcomeTracker] No market found for ${marketId.slice(0, 10)}...`);
                return null;
            }

            // Debug: log the relevant fields from Gamma API
            console.log(`[OutcomeTracker] Market ${marketId.slice(0, 10)}... status: closed=${market.closed}, umaResolutionStatus=${market.umaResolutionStatus}, outcomePrices=${market.outcomePrices}`);

            // Gamma API uses different field names than CLOB
            // Check if market is resolved - use umaResolutionStatus as primary indicator
            const isClosed = market.closed === true;
            const isResolved = market.umaResolutionStatus === 'resolved';

            // Try multiple ways to determine the outcome
            // Method 1: Direct outcome fields (legacy/some markets)
            let outcomeValue = market.outcome ?? market.winner ?? market.resolutionOutcome ?? market.resolution;

            // Method 2: Parse outcomePrices - price of 1 means that outcome won
            // outcomePrices format: "[\"0\", \"1\"]" or "[\"1\", \"0\"]"
            // outcomes format: "[\"Yes\", \"No\"]" or "[\"Up\", \"Down\"]"
            if (outcomeValue === undefined && market.outcomePrices && market.outcomes) {
                try {
                    const prices = typeof market.outcomePrices === 'string'
                        ? JSON.parse(market.outcomePrices)
                        : market.outcomePrices;
                    const outcomes = typeof market.outcomes === 'string'
                        ? JSON.parse(market.outcomes)
                        : market.outcomes;

                    // Find which outcome has price 1 (or close to 1)
                    const winnerIndex = prices.findIndex((p: string | number) => {
                        const price = typeof p === 'string' ? parseFloat(p) : p;
                        return price >= 0.99; // Winner has price ~1
                    });

                    if (winnerIndex !== -1 && outcomes[winnerIndex]) {
                        outcomeValue = outcomes[winnerIndex];
                        console.log(`[OutcomeTracker] Parsed outcomePrices: winner is "${outcomeValue}" (index ${winnerIndex})`);
                    }
                } catch (e) {
                    console.warn(`[OutcomeTracker] Failed to parse outcomePrices: ${e}`);
                }
            }

            if ((isClosed || isResolved) && outcomeValue !== undefined && outcomeValue !== null) {
                // Outcome can be: "Yes"/"No", "Up"/"Down", team names, player names, etc.
                const outcomeStr = String(outcomeValue).toLowerCase().trim();

                // Map common YES-equivalent outcomes (first position in binary markets)
                const yesEquivalents = ['yes', 'up', 'true', '1', 'over'];
                // Map common NO-equivalent outcomes (second position in binary markets)
                const noEquivalents = ['no', 'down', 'false', '0', 'under'];

                if (yesEquivalents.includes(outcomeStr) || outcomeValue === 1 || outcomeValue === true) {
                    console.log(`[OutcomeTracker] ✅ Market ${marketId.slice(0, 10)}... resolved to YES (${outcomeValue})`);
                    return 'YES';
                } else if (noEquivalents.includes(outcomeStr) || outcomeValue === 0 || outcomeValue === false) {
                    console.log(`[OutcomeTracker] ✅ Market ${marketId.slice(0, 10)}... resolved to NO (${outcomeValue})`);
                    return 'NO';
                } else {
                    // For non-binary markets (sports teams, player names, etc.)
                    // We need to check if the trade's side matches the winning outcome
                    // For now, map the first outcome to YES, second to NO (standard binary format)
                    // This handles cases like ["Lakers", "Celtics"] where index 0 = YES position
                    if (market.outcomes) {
                        const outcomes = typeof market.outcomes === 'string'
                            ? JSON.parse(market.outcomes)
                            : market.outcomes;
                        const winnerIndex = outcomes.findIndex((o: string) =>
                            o.toLowerCase().trim() === outcomeStr
                        );
                        if (winnerIndex === 0) {
                            console.log(`[OutcomeTracker] ✅ Market ${marketId.slice(0, 10)}... resolved to YES (first outcome: ${outcomeValue})`);
                            return 'YES';
                        } else if (winnerIndex >= 1) {
                            console.log(`[OutcomeTracker] ✅ Market ${marketId.slice(0, 10)}... resolved to NO (outcome index ${winnerIndex}: ${outcomeValue})`);
                            return 'NO';
                        }
                    }
                    // Fallback: log and skip if we can't determine
                    console.warn(`[OutcomeTracker] ⚠️ Market ${marketId.slice(0, 10)}... has non-binary outcome: ${outcomeValue}`);
                }
            }

            // Market is closed but not yet resolved (waiting for oracle)
            if (isClosed && !isResolved) {
                console.log(`[OutcomeTracker] ⏳ Market ${marketId.slice(0, 10)}... closed but awaiting resolution (umaStatus: ${market.umaResolutionStatus})`);
            }

            return null;
        } catch (error) {
            console.error(`[OutcomeTracker] Failed to fetch market outcome:`, error);
            return null;
        }
    }


    /**
     * Update market and all related trades with outcome
     */
    private async updateMarketOutcome(marketId: string, outcome: 'YES' | 'NO'): Promise<void> {
        console.log(`[OutcomeTracker] Market ${marketId.slice(0, 10)}... resolved: ${outcome}`);

        // Update market document
        await Market.updateOne(
            { marketId },
            {
                $set: {
                    resolved: true,
                    outcome,
                    resolvedAt: new Date(),
                },
            }
        );

        // Update all trades for this market
        const trades = await Trade.find({ marketId });

        for (const trade of trades) {
            const tradeWon = trade.side === outcome;
            const pnl = tradeWon
                ? trade.sizeUsd * (1 / trade.price - 1) // Winning trade profit
                : -trade.sizeUsd; // Losing trade loss

            await Trade.updateOne(
                { _id: trade._id },
                {
                    $set: {
                        marketResolved: true,
                        marketOutcome: outcome,
                        tradeWon,
                        pnl,
                    },
                }
            );

            // Update wallet win rate
            await this.updateWalletWinRate(trade.walletAddress);
        }

        console.log(`[OutcomeTracker] Updated ${trades.length} trades for resolved market`);
    }

    /**
     * Recalculate wallet win rate after trade resolution
     */
    private async updateWalletWinRate(walletAddress: string): Promise<void> {
        const trades = await Trade.find({
            walletAddress,
            marketResolved: true,
        });

        if (trades.length === 0) return;

        const wins = trades.filter(t => t.tradeWon === true).length;
        const winRate = wins / trades.length;

        // Calculate flagged win rate separately
        const flaggedTrades = trades.filter(t => t.insiderScore.isFlagged);
        const flaggedWins = flaggedTrades.filter(t => t.tradeWon === true).length;
        const flaggedWinRate = flaggedTrades.length > 0 ? flaggedWins / flaggedTrades.length : 0;

        const pnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

        await Wallet.updateOne(
            { address: walletAddress },
            {
                $set: {
                    winRate,
                    flaggedWinRate,
                    totalPnl: pnl,
                },
            }
        );
    }

    /**
     * Update daily metrics snapshot
     */
    private async updateDailyMetrics(): Promise<void> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get resolved trades
        const resolvedTrades = await Trade.find({ marketResolved: true });

        if (resolvedTrades.length === 0) return;

        const flaggedTrades = resolvedTrades.filter(t => t.insiderScore.isFlagged);
        const baselineTrades = resolvedTrades.filter(t => !t.insiderScore.isFlagged);

        const flaggedWins = flaggedTrades.filter(t => t.tradeWon === true).length;
        const baselineWins = baselineTrades.filter(t => t.tradeWon === true).length;

        const flaggedWinRate = flaggedTrades.length > 0 ? flaggedWins / flaggedTrades.length : 0;
        const baselineWinRate = baselineTrades.length > 0 ? baselineWins / baselineTrades.length : 0;
        const lift = flaggedWinRate - baselineWinRate;

        const avgScore = resolvedTrades.reduce((sum, t) => sum + t.insiderScore.total, 0) / resolvedTrades.length;

        await Metrics.findOneAndUpdate(
            { date: today },
            {
                $set: {
                    date: today,
                    totalTrades: await Trade.countDocuments(),
                    flaggedTrades: await Trade.countDocuments({ 'insiderScore.isFlagged': true }),
                    flaggedWinRate,
                    baselineWinRate,
                    lift,
                    avgScore,
                    resolvedFlaggedTrades: flaggedTrades.length,
                    resolvedBaselineTrades: baselineTrades.length,
                },
            },
            { upsert: true }
        );

        console.log(`[OutcomeTracker] Updated metrics: flagged=${(flaggedWinRate * 100).toFixed(1)}%, baseline=${(baselineWinRate * 100).toFixed(1)}%, lift=${(lift * 100).toFixed(1)}%`);
    }

    /**
     * Get current validation metrics
     */
    async getValidationMetrics(): Promise<{
        flaggedWinRate: number;
        baselineWinRate: number;
        lift: number;
        sampleSize: { flagged: number; baseline: number };
        statisticalSignificance: boolean;
    }> {
        if (!isMongoDBConnected()) {
            return {
                flaggedWinRate: 0,
                baselineWinRate: 0,
                lift: 0,
                sampleSize: { flagged: 0, baseline: 0 },
                statisticalSignificance: false,
            };
        }

        const latestMetrics = await Metrics.findOne().sort({ date: -1 });

        if (!latestMetrics) {
            return {
                flaggedWinRate: 0,
                baselineWinRate: 0,
                lift: 0,
                sampleSize: { flagged: 0, baseline: 0 },
                statisticalSignificance: false,
            };
        }

        // Basic statistical significance: need at least 30 samples each
        const statisticalSignificance =
            latestMetrics.resolvedFlaggedTrades >= 30 &&
            latestMetrics.resolvedBaselineTrades >= 30;

        return {
            flaggedWinRate: latestMetrics.flaggedWinRate,
            baselineWinRate: latestMetrics.baselineWinRate,
            lift: latestMetrics.lift,
            sampleSize: {
                flagged: latestMetrics.resolvedFlaggedTrades,
                baseline: latestMetrics.resolvedBaselineTrades,
            },
            statisticalSignificance,
        };
    }

    /**
     * Get PnL leaderboard - top performing wallets by ROI
     * Aggregates completed trades to calculate PnL and win rates
     */
    async getLeaderboard(limit: number = 20): Promise<LeaderboardEntry[]> {
        if (!isMongoDBConnected()) {
            return [];
        }

        try {
            const leaderboard = await Trade.aggregate([
                // Only count resolved trades
                { $match: { resolved: true } },
                // Group by wallet
                {
                    $group: {
                        _id: '$walletAddress',
                        totalTrades: { $sum: 1 },
                        wins: {
                            $sum: { $cond: ['$won', 1, 0] }
                        },
                        losses: {
                            $sum: { $cond: [{ $eq: ['$won', false] }, 1, 0] }
                        },
                        totalPnl: {
                            $sum: {
                                $cond: [
                                    '$won',
                                    { $subtract: ['$payout', '$cost'] }, // Profit
                                    { $multiply: ['$cost', -1] }            // Loss (cost as negative)
                                ]
                            }
                        },
                        totalCost: { $sum: '$cost' },
                        avgTradeSize: { $avg: '$sizeUsd' },
                        lastTradeDate: { $max: '$timestamp' },
                    }
                },
                // Filter out wallets with no address
                { $match: { _id: { $nin: [null, ''] } } },
                // Calculate derived fields
                {
                    $addFields: {
                        winRate: {
                            $cond: [
                                { $gt: [{ $add: ['$wins', '$losses'] }, 0] },
                                { $multiply: [{ $divide: ['$wins', { $add: ['$wins', '$losses'] }] }, 100] },
                                0
                            ]
                        },
                        roi: {
                            $cond: [
                                { $gt: ['$totalCost', 0] },
                                { $multiply: [{ $divide: ['$totalPnl', '$totalCost'] }, 100] },
                                0
                            ]
                        }
                    }
                },
                // Sort by ROI descending
                { $sort: { roi: -1 } },
                // Limit results
                { $limit: limit },
                // Project final shape
                {
                    $project: {
                        _id: 0,
                        walletAddress: '$_id',
                        totalTrades: 1,
                        wins: 1,
                        losses: 1,
                        winRate: { $round: ['$winRate', 1] },
                        totalPnl: { $round: ['$totalPnl', 2] },
                        roi: { $round: ['$roi', 1] },
                        avgTradeSize: { $round: ['$avgTradeSize', 2] },
                        lastTradeDate: 1,
                    }
                }
            ]);

            // Add rank
            return leaderboard.map((entry, index) => ({
                ...entry,
                rank: index + 1,
            }));
        } catch (error) {
            console.error('[OutcomeTracker] Error generating leaderboard:', error);
            return [];
        }
    }

    /**
     * Get stats for a specific wallet
     */
    async getWalletStats(walletAddress: string): Promise<LeaderboardEntry | null> {
        if (!isMongoDBConnected()) {
            return null;
        }

        try {
            const normalized = walletAddress.toLowerCase();
            const results = await Trade.aggregate([
                { $match: { walletAddress: normalized, resolved: true } },
                {
                    $group: {
                        _id: '$walletAddress',
                        totalTrades: { $sum: 1 },
                        wins: { $sum: { $cond: ['$won', 1, 0] } },
                        losses: { $sum: { $cond: [{ $eq: ['$won', false] }, 1, 0] } },
                        totalPnl: {
                            $sum: {
                                $cond: [
                                    '$won',
                                    { $subtract: ['$payout', '$cost'] },
                                    { $multiply: ['$cost', -1] }
                                ]
                            }
                        },
                        totalCost: { $sum: '$cost' },
                        avgTradeSize: { $avg: '$sizeUsd' },
                        lastTradeDate: { $max: '$timestamp' },
                    }
                },
                {
                    $addFields: {
                        winRate: {
                            $cond: [
                                { $gt: [{ $add: ['$wins', '$losses'] }, 0] },
                                { $multiply: [{ $divide: ['$wins', { $add: ['$wins', '$losses'] }] }, 100] },
                                0
                            ]
                        },
                        roi: {
                            $cond: [
                                { $gt: ['$totalCost', 0] },
                                { $multiply: [{ $divide: ['$totalPnl', '$totalCost'] }, 100] },
                                0
                            ]
                        }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        walletAddress: '$_id',
                        totalTrades: 1,
                        wins: 1,
                        losses: 1,
                        winRate: { $round: ['$winRate', 1] },
                        totalPnl: { $round: ['$totalPnl', 2] },
                        roi: { $round: ['$roi', 1] },
                        avgTradeSize: { $round: ['$avgTradeSize', 2] },
                        lastTradeDate: 1,
                    }
                }
            ]);

            return results[0] || null;
        } catch (error) {
            console.error('[OutcomeTracker] Error getting wallet stats:', error);
            return null;
        }
    }
}
