import { Trade, Market, Metrics, Wallet, isMongoDBConnected } from '../db/index.js';

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
            // Try by condition ID first (most markets use this)
            let response = await fetch(`${GAMMA_API_URL}/markets?condition_id=${marketId}`);

            if (!response.ok || (await response.clone().json() as any[]).length === 0) {
                // Fallback: try by clob_token_ids (for token ID-based lookups)
                response = await fetch(`${GAMMA_API_URL}/markets?clob_token_ids=${marketId}&limit=1`);
            }

            if (!response.ok || (await response.clone().json() as any[]).length === 0) {
                // Fallback: try by slug if both fail
                response = await fetch(`${GAMMA_API_URL}/markets?id=${marketId}`);
            }

            if (!response.ok) {
                console.warn(`[OutcomeTracker] Gamma API returned ${response.status} for market ${marketId.slice(0, 10)}...`);
                return null;
            }

            const data = await response.json() as any;

            // Gamma API returns an array - get first match
            const market = Array.isArray(data) && data.length > 0 ? data[0] : data;

            if (!market) {
                console.warn(`[OutcomeTracker] No market found for ${marketId.slice(0, 10)}...`);
                return null;
            }

            // Debug: log the relevant fields from Gamma API
            console.log(`[OutcomeTracker] Market ${marketId.slice(0, 10)}... status: closed=${market.closed}, resolved=${market.resolved}, outcome=${market.outcome}, winner=${market.winner}`);

            // Gamma API uses different field names than CLOB
            // Check if market is resolved and get outcome
            const isClosed = market.closed === true || market.resolved === true;

            // Gamma API outcome fields (in order of preference)
            const outcomeValue = market.outcome ?? market.winner ?? market.resolutionOutcome ?? market.resolution;

            if (isClosed && outcomeValue !== undefined && outcomeValue !== null) {
                // Outcome can be: "Yes"/"No", 1/0, or token_id
                const outcomeStr = String(outcomeValue).toLowerCase();

                if (outcomeStr === 'yes' || outcomeStr === '1' || outcomeValue === 1) {
                    console.log(`[OutcomeTracker] ✅ Market ${marketId.slice(0, 10)}... resolved to YES`);
                    return 'YES';
                } else if (outcomeStr === 'no' || outcomeStr === '0' || outcomeValue === 0) {
                    console.log(`[OutcomeTracker] ✅ Market ${marketId.slice(0, 10)}... resolved to NO`);
                    return 'NO';
                }
            }

            // Market is closed but not yet resolved (waiting for oracle)
            if (isClosed && outcomeValue === undefined) {
                console.log(`[OutcomeTracker] ⏳ Market ${marketId.slice(0, 10)}... closed but awaiting resolution`);
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
}
