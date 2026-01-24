import { Router, Request, Response } from 'express';
import { Trade, Wallet, isMongoDBConnected } from '../db/index.js';
import { EnrichedTrade } from '../types/index.js';
import { InsiderScorer } from '../services/insiderScorer.js';
import { PolymarketWebSocket } from '../services/websocket.js';

/**
 * Admin Dashboard API Routes
 * Provides monitoring, management, and WebSocket subscription endpoints
 */
export function createAdminRouter(
    tradeHistory: Map<string, EnrichedTrade>,
    insiderScorer?: InsiderScorer,
    polymarketWs?: PolymarketWebSocket
): Router {
    const router = Router();

    /**
     * GET /api/admin/stats
     * Overall system statistics
     */
    router.get('/stats', async (_req: Request, res: Response) => {
        try {
            const trades = Array.from(tradeHistory.values());
            const flaggedTrades = trades.filter(t => t.isFlagged);

            // Calculate average score
            const scores = trades.map(t => t.insiderScore?.breakdown.total || 0);
            const avgScore = scores.length > 0
                ? scores.reduce((a, b) => a + b, 0) / scores.length
                : 0;

            // Get time-based stats
            const now = Date.now();
            const oneHourAgo = now - 60 * 60 * 1000;
            const tradesLastHour = trades.filter(t =>
                new Date(t.timestamp).getTime() > oneHourAgo
            ).length;

            // MongoDB stats if available
            let dbStats = null;
            if (isMongoDBConnected()) {
                const [tradeCount, walletCount] = await Promise.all([
                    Trade.countDocuments(),
                    Wallet.countDocuments()
                ]);
                dbStats = { tradeCount, walletCount };
            }

            res.json({
                inMemory: {
                    totalTrades: trades.length,
                    flaggedTrades: flaggedTrades.length,
                    flagRate: trades.length > 0
                        ? ((flaggedTrades.length / trades.length) * 100).toFixed(1) + '%'
                        : '0%',
                    avgScore: avgScore.toFixed(1),
                    tradesLastHour,
                },
                errors: insiderScorer ? insiderScorer.getErrorStats() : null,
                database: dbStats,
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            console.error('[AdminRoutes] Error fetching stats:', error);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    /**
     * GET /api/admin/flagged-wallets
     * List wallets with high insider scores
     */
    router.get('/flagged-wallets', async (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const trades = Array.from(tradeHistory.values());

            // Group by wallet address and calculate avg score
            const walletStats = new Map<string, {
                address: string;
                avgScore: number;
                flaggedCount: number;
                totalVolume: number;
                lastTrade: Date;
            }>();

            for (const trade of trades) {
                const addr = trade.walletAddress || 'Unknown';
                if (addr === 'Unknown') continue;

                const existing = walletStats.get(addr) || {
                    address: addr,
                    avgScore: 0,
                    flaggedCount: 0,
                    totalVolume: 0,
                    lastTrade: new Date(0),
                };

                const score = trade.insiderScore?.breakdown.total || 0;
                existing.avgScore = (existing.avgScore * existing.flaggedCount + score) / (existing.flaggedCount + 1);
                if (trade.isFlagged) existing.flaggedCount++;
                existing.totalVolume += trade.sizeUsd;

                const tradeDate = new Date(trade.timestamp);
                if (tradeDate > existing.lastTrade) {
                    existing.lastTrade = tradeDate;
                }

                walletStats.set(addr, existing);
            }

            // Sort by average score descending
            const sorted = Array.from(walletStats.values())
                .filter(w => w.flaggedCount > 0)
                .sort((a, b) => b.avgScore - a.avgScore)
                .slice(0, limit);

            res.json({
                wallets: sorted.map(w => ({
                    address: w.address,
                    avgScore: w.avgScore.toFixed(1),
                    flaggedCount: w.flaggedCount,
                    totalVolume: `$${w.totalVolume.toLocaleString()}`,
                    lastTrade: w.lastTrade.toISOString(),
                    polymarketUrl: `https://polymarket.com/profile/${w.address}`,
                })),
                total: sorted.length,
            });
        } catch (error) {
            console.error('[AdminRoutes] Error fetching flagged wallets:', error);
            res.status(500).json({ error: 'Failed to fetch flagged wallets' });
        }
    });

    /**
     * GET /api/admin/markets
     * List tracked markets and their status
     */
    router.get('/markets', async (_req: Request, res: Response) => {
        try {
            const trades = Array.from(tradeHistory.values());

            // Group by market
            const marketStats = new Map<string, {
                id: string;
                title: string;
                category: string;
                tradeCount: number;
                totalVolume: number;
                avgScore: number;
            }>();

            for (const trade of trades) {
                const id = trade.marketId || 'Unknown';
                const existing = marketStats.get(id) || {
                    id,
                    title: trade.marketTitle || 'Unknown',
                    category: trade.marketCategory || 'other',
                    tradeCount: 0,
                    totalVolume: 0,
                    avgScore: 0,
                };

                const score = trade.insiderScore?.breakdown.total || 0;
                existing.avgScore = (existing.avgScore * existing.tradeCount + score) / (existing.tradeCount + 1);
                existing.tradeCount++;
                existing.totalVolume += trade.sizeUsd;

                marketStats.set(id, existing);
            }

            // Sort by trade count descending
            const sorted = Array.from(marketStats.values())
                .sort((a, b) => b.tradeCount - a.tradeCount)
                .slice(0, 50);

            res.json({
                markets: sorted.map(m => ({
                    id: m.id,
                    title: m.title.slice(0, 60) + (m.title.length > 60 ? '...' : ''),
                    category: m.category,
                    tradeCount: m.tradeCount,
                    totalVolume: `$${m.totalVolume.toLocaleString()}`,
                    avgScore: m.avgScore.toFixed(1),
                })),
                total: marketStats.size,
            });
        } catch (error) {
            console.error('[AdminRoutes] Error fetching markets:', error);
            res.status(500).json({ error: 'Failed to fetch markets' });
        }
    });

    /**
     * GET /api/admin/pnl-status
     * PnL tracking status and pending resolutions
     */
    router.get('/pnl-status', async (_req: Request, res: Response) => {
        try {
            if (!isMongoDBConnected()) {
                res.json({
                    status: 'disabled',
                    message: 'MongoDB not connected - PnL tracking unavailable',
                });
                return;
            }

            // Get trades pending resolution
            const pendingCount = await Trade.countDocuments({
                resolved: false,
            });

            // Get resolved trades with PnL
            const resolvedTrades = await Trade.find({
                resolved: true,
            }).select('walletAddress pnl outcome').limit(100);

            // Calculate overall PnL stats
            let totalPnl = 0;
            let wins = 0;
            let losses = 0;

            for (const trade of resolvedTrades) {
                if (trade.pnl) {
                    totalPnl += trade.pnl;
                    if (trade.pnl > 0) wins++;
                    else if (trade.pnl < 0) losses++;
                }
            }

            res.json({
                status: 'active',
                pendingResolution: pendingCount,
                resolved: {
                    total: resolvedTrades.length,
                    wins,
                    losses,
                    winRate: resolvedTrades.length > 0
                        ? ((wins / resolvedTrades.length) * 100).toFixed(1) + '%'
                        : 'N/A',
                    totalPnl: `$${totalPnl.toFixed(2)}`,
                },
            });
        } catch (error) {
            console.error('[AdminRoutes] Error fetching PnL status:', error);
            res.status(500).json({ error: 'Failed to fetch PnL status' });
        }
    });

    /**
     * GET /api/admin/factor-breakdown
     * Average score per factor across all flagged trades
     */
    router.get('/factor-breakdown', async (_req: Request, res: Response) => {
        try {
            const trades = Array.from(tradeHistory.values());
            const flaggedTrades = trades.filter(t => t.isFlagged && t.insiderScore?.breakdown);

            if (flaggedTrades.length === 0) {
                res.json({
                    message: 'No flagged trades yet',
                    factors: null,
                    distribution: null,
                });
                return;
            }

            // Calculate average per factor
            const factors = {
                walletAge: { avg: 0, max: 25, count: 0 },
                tradeSize: { avg: 0, max: 20, count: 0 },
                timing: { avg: 0, max: 40, count: 0 },
                diversification: { avg: 0, max: 30, count: 0 },
                onChainSource: { avg: 0, max: 15, count: 0 },
                specificity: { avg: 0, max: 10, count: 0 },
                impact: { avg: 0, max: 10, count: 0 },
                connections: { avg: 0, max: 20, count: 0 },
                orderFlow: { avg: 0, max: 10, count: 0 },
                cluster: { avg: 0, max: 30, count: 0 },
            };

            for (const trade of flaggedTrades) {
                const b = trade.insiderScore!.breakdown;
                factors.walletAge.avg += b.walletAge || 0;
                factors.tradeSize.avg += b.tradeSize || 0;
                factors.timing.avg += b.timing || 0;
                factors.diversification.avg += b.diversification || 0;
                factors.onChainSource.avg += b.onChainSource || 0;
                factors.specificity.avg += b.specificity || 0;
                factors.impact.avg += b.impact || 0;
                factors.connections.avg += b.connections || 0;
                factors.orderFlow.avg += b.orderFlow || 0;
                factors.cluster.avg += b.cluster || 0;
            }

            const count = flaggedTrades.length;
            Object.keys(factors).forEach(key => {
                const f = factors[key as keyof typeof factors];
                f.avg = Number((f.avg / count).toFixed(1));
                f.count = count;
            });

            // Score distribution buckets
            const distribution = {
                '65-70': 0,
                '70-75': 0,
                '75-80': 0,
                '80-85': 0,
                '85-90': 0,
                '90+': 0,
            };

            for (const trade of flaggedTrades) {
                const score = trade.insiderScore!.breakdown.total || 0;
                if (score >= 90) distribution['90+']++;
                else if (score >= 85) distribution['85-90']++;
                else if (score >= 80) distribution['80-85']++;
                else if (score >= 75) distribution['75-80']++;
                else if (score >= 70) distribution['70-75']++;
                else if (score >= 65) distribution['65-70']++;
            }

            res.json({
                factors,
                distribution,
                totalFlagged: flaggedTrades.length,
                maxPossibleScore: 210,
            });
        } catch (error) {
            console.error('[AdminRoutes] Error fetching factor breakdown:', error);
            res.status(500).json({ error: 'Failed to fetch factor breakdown' });
        }
    });

    // =============================================================================
    // WebSocket Subscription Management
    // =============================================================================

    /**
     * GET /api/admin/subscriptions
     * Get current WebSocket subscription status
     */
    router.get('/subscriptions', (_req: Request, res: Response) => {
        try {
            if (!polymarketWs) {
                res.json({
                    status: 'unavailable',
                    message: 'WebSocket service not injected',
                });
                return;
            }

            const subscribedAssets = polymarketWs.getSubscribedAssets();
            const isConnected = polymarketWs.isConnected();

            res.json({
                status: isConnected ? 'connected' : 'disconnected',
                totalSubscriptions: subscribedAssets.length,
                assets: subscribedAssets.slice(0, 100), // Limit response size
                hasMore: subscribedAssets.length > 100,
            });
        } catch (error) {
            console.error('[AdminRoutes] Error fetching subscriptions:', error);
            res.status(500).json({ error: 'Failed to fetch subscriptions' });
        }
    });

    /**
     * GET /api/admin/subscriptions/health
     * Get WebSocket connection health stats
     */
    router.get('/subscriptions/health', (_req: Request, res: Response) => {
        try {
            if (!polymarketWs) {
                res.json({
                    status: 'unavailable',
                    message: 'WebSocket service not injected',
                });
                return;
            }

            const subscribedAssets = polymarketWs.getSubscribedAssets();
            const isConnected = polymarketWs.isConnected();

            res.json({
                status: isConnected ? 'healthy' : 'unhealthy',
                connected: isConnected,
                totalSubscriptions: subscribedAssets.length,
                memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            console.error('[AdminRoutes] Error fetching health:', error);
            res.status(500).json({ error: 'Failed to fetch health' });
        }
    });

    /**
     * POST /api/admin/subscriptions/refresh
     * Force refresh subscriptions with latest active markets
     */
    router.post('/subscriptions/refresh', async (req: Request, res: Response) => {
        try {
            if (!polymarketWs) {
                res.status(503).json({ error: 'WebSocket service not available' });
                return;
            }

            const activeAssetIds: string[] = req.body.assetIds;
            if (!activeAssetIds || !Array.isArray(activeAssetIds)) {
                res.status(400).json({ error: 'assetIds array is required in body' });
                return;
            }

            console.log(`[AdminRoutes] Manual subscription refresh with ${activeAssetIds.length} markets`);
            await polymarketWs.refreshSubscriptions(activeAssetIds);

            res.json({
                success: true,
                message: 'Subscriptions refreshed',
                newCount: polymarketWs.getSubscribedAssets().length,
            });
        } catch (error) {
            console.error('[AdminRoutes] Error refreshing subscriptions:', error);
            res.status(500).json({ error: 'Failed to refresh subscriptions' });
        }
    });

    return router;
}
