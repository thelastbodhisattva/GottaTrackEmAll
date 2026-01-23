import { Router, Request, Response } from 'express';
import { WalletProfiler } from '../services/walletProfiler.js';
import { MarketService } from '../services/marketService.js';
import { HansonQuotes } from '../utils/hansonQuotes.js';
import { config } from '../config/index.js';
import { EnrichedTrade } from '../types/index.js';
import { isMongoDBConnected } from '../db/index.js';
import { validate, tradesQuerySchema, walletParamsSchema } from '../validation/schemas.js';

const startTime = Date.now();

/**
 * Create Express router with all API endpoints
 */
export function createRouter(
    profiler: WalletProfiler,
    marketService: MarketService,
    tradeHistory: Map<string, EnrichedTrade>
): Router {
    const router = Router();

    // Health check - enhanced for Docker HEALTHCHECK
    router.get('/health', (_req: Request, res: Response) => {
        const memUsage = process.memoryUsage();
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            uptime: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
            mongodb: isMongoDBConnected() ? 'connected' : 'disconnected',
            memory: {
                heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            },
            tradesInMemory: tradeHistory.size,
        });
    });

    // Get configuration
    router.get('/config', (_req: Request, res: Response) => {
        res.json({
            whaleThreshold: config.whaleThresholdUsd,
            insiderScoreThreshold: config.insiderScoreThreshold,
            targetCategories: config.targetCategories,
        });
    });

    // ==========================================================================
    // Trade endpoints
    // ==========================================================================

    /**
     * @swagger
     * /api/trades:
     *   get:
     *     summary: Get recent whale trades
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *         description: Number of trades to return (max 100)
     *       - in: query
     *         name: category
     *         schema:
     *           type: string
     *         description: Filter by market category (e.g. geopolitics)
     *       - in: query
     *         name: flagged
     *         schema:
     *           type: boolean
     *         description: Return only flagged trades
     *     responses:
     *       200:
     *         description: List of enriched trades
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/Trade'
     */
    // Get recent trades (whale tape) - queries MongoDB if in-memory is empty
    router.get('/trades', validate(tradesQuerySchema), async (req: Request, res: Response) => {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const category = req.query.category as string;
        const flaggedOnly = req.query.flagged === 'true';

        let trades = Array.from(tradeHistory.values());

        // If in-memory is empty, try to fetch from MongoDB
        if (trades.length === 0 && isMongoDBConnected()) {
            try {
                // Dynamic import to avoid circular dependency
                const { Trade } = await import('../db/models/trade.js');

                const query: any = {};
                if (category) query.marketCategory = category;
                if (flaggedOnly) query['insiderScore.isFlagged'] = true;

                const dbTrades = await Trade.find(query)
                    .sort({ timestamp: -1 })
                    .limit(limit)
                    .lean();

                // Convert MongoDB format to EnrichedTrade format (use 'as any' for flexible mapping)
                trades = dbTrades.map((t: any) => ({
                    id: t.tradeId,
                    walletAddress: t.walletAddress,
                    proxyWalletAddress: t.proxyWalletAddress,
                    marketId: t.marketId,
                    marketTitle: t.marketTitle,
                    marketCategory: t.marketCategory,
                    side: t.side,
                    price: t.price,
                    priceBefore: t.priceBefore || t.price,
                    priceAfter: t.priceAfter || t.price,
                    sizeUsd: t.sizeUsd,
                    shares: t.shares || t.sizeUsd / t.price,
                    timestamp: t.timestamp,
                    marketAvgVolume: t.marketAvgVolume || 0,
                    insiderScore: t.insiderScore,
                    isFlagged: t.insiderScore?.isFlagged || false,
                    isWhale: t.sizeUsd >= 5000,
                    transactionHash: t.transactionHash,
                    walletProfile: t.walletProfile || { totalTrades: 0, totalPnl: 0, winRate: 0, avgTradeSize: 0, marketsTraded: [], firstSeen: new Date(), lastActive: new Date(), tags: [], address: t.walletAddress },
                })) as any;

                console.log(`[API] Loaded ${trades.length} trades from MongoDB`);
            } catch (err) {
                console.error('[API] Failed to fetch trades from MongoDB:', err);
            }
        }

        // Apply filters if trades came from memory
        if (category && trades.length > 0) {
            trades = trades.filter(t => t.marketCategory === category);
        }
        if (flaggedOnly && trades.length > 0) {
            trades = trades.filter(t => t.isFlagged);
        }

        // Sort by timestamp (newest first) and limit
        trades = trades
            .sort((a, b) =>
                new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
            )
            .slice(0, limit);

        res.json({
            data: trades,
            total: trades.length,
            filters: { category, flaggedOnly },
        });
    });

    // Get single trade by ID
    router.get('/trades/:id', (req: Request, res: Response) => {
        const trade = tradeHistory.get(req.params.id);
        if (!trade) {
            res.status(404).json({ error: 'Trade not found' });
            return;
        }
        res.json(trade);
    });

    // ==========================================================================
    // Wallet endpoints
    // ==========================================================================

    // Get wallet profile
    router.get('/wallets/:address', validate(walletParamsSchema, 'params'), async (req: Request, res: Response) => {
        try {
            const profile = await profiler.getProfile(req.params.address);
            res.json(profile);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch wallet profile' });
        }
    });

    // Get leaderboard
    router.get('/wallets', async (req: Request, res: Response) => {
        try {
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
            const tag = req.query.tag as string;

            let wallets;
            if (tag) {
                wallets = await profiler.getByTag(tag);
            } else {
                wallets = await profiler.getLeaderboard(limit);
            }

            res.json({
                data: wallets,
                total: wallets.length,
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch wallets' });
        }
    });

    // Get flagged wallets
    router.get('/wallets/flagged', async (_req: Request, res: Response) => {
        try {
            const flagged = await profiler.getFlagged();
            res.json({
                data: flagged,
                total: flagged.length,
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch flagged wallets' });
        }
    });

    // Search wallets
    router.get('/wallets/search/:prefix', async (req: Request, res: Response) => {
        try {
            const results = await profiler.searchByAddress(req.params.prefix);
            res.json({
                data: results.slice(0, 10),
                total: results.length,
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to search wallets' });
        }
    });

    // ==========================================================================
    // Market endpoints
    // ==========================================================================

    // Get market by ID
    router.get('/markets/:id', async (req: Request, res: Response) => {
        try {
            const market = await marketService.getMarket(req.params.id);
            if (!market) {
                res.status(404).json({ error: 'Market not found' });
                return;
            }
            res.json(market);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch market' });
        }
    });

    // Get markets by category
    router.get('/markets', async (req: Request, res: Response) => {
        try {
            const category = req.query.category as string;

            let markets;
            if (category) {
                markets = await marketService.getMarketsByCategory(category as 'geopolitics' | 'war' | 'crypto' | 'other');
            } else {
                markets = await marketService.getActiveMarkets();
            }

            res.json({
                data: markets,
                total: markets.length,
                cacheStats: marketService.getCacheStats(),
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch markets' });
        }
    });

    // ==========================================================================
    // Ethics / Hanson endpoints
    // ==========================================================================

    // Get random Hanson quote
    router.get('/ethics/quote', (_req: Request, res: Response) => {
        res.json(HansonQuotes.getRandomFull());
    });

    // Get all Hanson quotes
    router.get('/ethics/quotes', (_req: Request, res: Response) => {
        res.json({
            data: HansonQuotes.getAll(),
            total: HansonQuotes.quotes.length,
        });
    });

    // Get educational note
    router.get('/ethics/note', (_req: Request, res: Response) => {
        res.json({
            note: HansonQuotes.getEducationalNote(),
            brief: HansonQuotes.getBriefNote(),
        });
    });

    // ==========================================================================
    // Stats endpoints
    // ==========================================================================

    // Get overall statistics
    router.get('/stats', async (_req: Request, res: Response) => {
        try {
            const walletCount = await profiler.getTotalCount();
            const trades = Array.from(tradeHistory.values());
            const flaggedTrades = trades.filter(t => t.isFlagged).length;
            const totalVolume = trades.reduce((sum, t) =>
                sum + (t.sizeUsd || 0), 0
            );

            res.json({
                totalTrades: trades.length,
                flaggedTrades,
                totalVolume,
                trackedWallets: walletCount,
                marketStats: marketService.getCacheStats(),
                uptime: process.uptime(),
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    return router;
}
