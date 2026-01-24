import { Router, Request, Response } from 'express';
import { Trade, Wallet, Market, Metrics, isMongoDBConnected } from '../db/index.js';
import { OutcomeTracker } from '../services/outcomeTracker.js';

/**
 * Create metrics router with injected OutcomeTracker
 * This avoids creating a new OutcomeTracker per request
 */
export function createMetricsRouter(outcomeTracker: OutcomeTracker): Router {
    const router = Router();

    /**
     * GET /api/metrics/summary
     * Returns algorithm validation summary with win rate lift
     */
    router.get('/summary', async (_req: Request, res: Response) => {
        if (!isMongoDBConnected()) {
            res.status(503).json({ error: 'Database not connected' });
            return;
        }

        try {
            // Get latest metrics snapshot
            const latestMetrics = await Metrics.findOne().sort({ date: -1 });

            // Get overall counts
            const [totalTrades, flaggedTrades, totalWallets, resolvedMarkets] = await Promise.all([
                Trade.countDocuments(),
                Trade.countDocuments({ 'insiderScore.isFlagged': true }),
                Wallet.countDocuments(),
                Market.countDocuments({ resolved: true }),
            ]);

            // Calculate factor contributions from flagged trades
            const flaggedTradesData = await Trade.find({ 'insiderScore.isFlagged': true })
                .select('insiderScore.breakdown')
                .limit(100);

            const factorContributions = calculateFactorContributions(flaggedTradesData);

            res.json({
                period: '7d',
                totalTrades,
                flaggedTrades,
                totalWallets,
                resolvedMarkets,
                flaggedWinRate: latestMetrics?.flaggedWinRate || 0,
                baselineWinRate: latestMetrics?.baselineWinRate || 0,
                lift: latestMetrics?.lift || 0,
                avgScore: latestMetrics?.avgScore || 0,
                sampleSize: {
                    flagged: latestMetrics?.resolvedFlaggedTrades || 0,
                    baseline: latestMetrics?.resolvedBaselineTrades || 0,
                },
                statisticalSignificance:
                    (latestMetrics?.resolvedFlaggedTrades || 0) >= 30 &&
                    (latestMetrics?.resolvedBaselineTrades || 0) >= 30,
                topFactors: factorContributions,
            });
        } catch (error) {
            console.error('[MetricsAPI] Failed to get summary:', error);
            res.status(500).json({ error: 'Failed to get metrics' });
        }
    });

    /**
     * GET /api/metrics/history?days=30
     * Returns historical metrics for charting
     */
    router.get('/history', async (req: Request, res: Response) => {
        if (!isMongoDBConnected()) {
            res.status(503).json({ error: 'Database not connected' });
            return;
        }

        try {
            const days = parseInt(req.query.days as string) || 30;
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const metrics = await Metrics.find({ date: { $gte: startDate } })
                .sort({ date: 1 });

            res.json({
                dates: metrics.map(m => m.date.toISOString().split('T')[0]),
                flaggedWinRates: metrics.map(m => m.flaggedWinRate),
                baselineWinRates: metrics.map(m => m.baselineWinRate),
                lifts: metrics.map(m => m.lift),
                tradeVolumes: metrics.map(m => m.totalTrades),
            });
        } catch (error) {
            console.error('[MetricsAPI] Failed to get history:', error);
            res.status(500).json({ error: 'Failed to get history' });
        }
    });

    /**
     * GET /api/metrics/wallets/leaderboard
     * Returns top performing wallets
     */
    router.get('/wallets/leaderboard', async (req: Request, res: Response) => {
        if (!isMongoDBConnected()) {
            res.status(503).json({ error: 'Database not connected' });
            return;
        }

        try {
            const metric = (req.query.metric as string) || 'winRate';
            const flaggedOnly = req.query.flaggedOnly === 'true';
            const limit = parseInt(req.query.limit as string) || 20;

            const filter = flaggedOnly ? { flaggedTrades: { $gt: 0 } } : {};
            const sortField = metric === 'winRate' ? 'flaggedWinRate' :
                metric === 'pnl' ? 'totalPnl' : 'avgInsiderScore';

            const wallets = await Wallet.find(filter)
                .sort({ [sortField]: -1 })
                .limit(limit)
                .select('address totalTrades flaggedTrades winRate flaggedWinRate totalPnl avgInsiderScore tags');

            res.json({
                leaderboard: wallets.map(w => ({
                    address: w.address,
                    totalTrades: w.totalTrades,
                    flaggedTrades: w.flaggedTrades,
                    winRate: w.winRate,
                    flaggedWinRate: w.flaggedWinRate,
                    totalPnl: w.totalPnl,
                    avgInsiderScore: w.avgInsiderScore,
                    tags: w.tags,
                })),
            });
        } catch (error) {
            console.error('[MetricsAPI] Failed to get leaderboard:', error);
            res.status(500).json({ error: 'Failed to get leaderboard' });
        }
    });

    /**
     * GET /api/metrics/validation
     * Returns algorithm validation metrics (uses injected singleton)
     */
    router.get('/validation', async (_req: Request, res: Response) => {
        if (!isMongoDBConnected()) {
            res.status(503).json({ error: 'Database not connected' });
            return;
        }

        try {
            // Use injected singleton instead of creating new instance
            const validation = await outcomeTracker.getValidationMetrics();
            res.json(validation);
        } catch (error) {
            console.error('[MetricsAPI] Failed to get validation:', error);
            res.status(500).json({ error: 'Failed to get validation' });
        }
    });

    /**
     * POST /api/metrics/backfill
     * Retroactively resolve all unresolved markets in the database
     * This is a one-time operation to fix markets that weren't resolved properly
     */
    router.post('/backfill', async (_req: Request, res: Response) => {
        if (!isMongoDBConnected()) {
            res.status(503).json({ error: 'Database not connected' });
            return;
        }

        try {
            console.log('[MetricsAPI] Starting market backfill...');
            const result = await outcomeTracker.backfillUnresolvedMarkets();
            res.json({
                success: true,
                message: 'Backfill completed',
                ...result
            });
        } catch (error) {
            console.error('[MetricsAPI] Failed to backfill:', error);
            res.status(500).json({ error: 'Failed to backfill markets' });
        }
    });

    /**
     * GET /api/metrics/leaderboard
     * Returns PnL leaderboard for tracked wallets
     * Query params: limit (default 20, max 100)
     */
    router.get('/leaderboard', async (req: Request, res: Response) => {
        if (!isMongoDBConnected()) {
            res.status(503).json({ error: 'Database not connected' });
            return;
        }

        try {
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
            const leaderboard = await outcomeTracker.getLeaderboard(limit);
            res.json({
                period: 'all-time',
                entries: leaderboard,
                total: leaderboard.length,
            });
        } catch (error) {
            console.error('[MetricsAPI] Failed to get leaderboard:', error);
            res.status(500).json({ error: 'Failed to get leaderboard' });
        }
    });

    /**
     * GET /api/metrics/leaderboard/:wallet
     * Returns PnL stats for a specific wallet
     */
    router.get('/leaderboard/:wallet', async (req: Request, res: Response) => {
        if (!isMongoDBConnected()) {
            res.status(503).json({ error: 'Database not connected' });
            return;
        }

        try {
            const { wallet } = req.params;
            if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
                res.status(400).json({ error: 'Invalid wallet address' });
                return;
            }

            const stats = await outcomeTracker.getWalletStats(wallet);
            if (!stats) {
                res.status(404).json({ error: 'Wallet not found or no resolved trades' });
                return;
            }

            res.json(stats);
        } catch (error) {
            console.error('[MetricsAPI] Failed to get wallet stats:', error);
            res.status(500).json({ error: 'Failed to get wallet stats' });
        }
    });

    return router;
}

/**
 * Calculate average contribution of each factor in flagged trades
 */
function calculateFactorContributions(trades: any[]): Array<{ name: string; avgContribution: number }> {
    if (trades.length === 0) return [];

    const factors = [
        'walletAge', 'tradeSize', 'timing', 'diversification',
        'onChainSource', 'specificity', 'impact', 'connections', 'orderFlow'
    ];

    const contributions = factors.map(factor => {
        const sum = trades.reduce((acc, t) =>
            acc + (t.insiderScore?.breakdown?.[factor] || 0), 0
        );
        return {
            name: factor,
            avgContribution: sum / trades.length,
        };
    });

    return contributions.sort((a, b) => b.avgContribution - a.avgContribution);
}

