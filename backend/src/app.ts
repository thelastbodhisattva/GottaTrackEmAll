import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import swaggerUi from 'swagger-ui-express';
import { specs } from './config/swagger.js';

import { config } from './config/index.js';
import { PolymarketWebSocket } from './services/websocket.js';
import { TradeProcessor } from './services/tradeProcessor.js';
import { InsiderScorer } from './services/insiderScorer.js';
import { WalletProfiler } from './services/walletProfiler.js';
import { MarketService } from './services/marketService.js';
import { AlertService } from './services/alertService.js';
import { MarketFetcher } from './services/marketFetcher.js';
import { PolygonRpcClient } from './clients/polygonRpc.js';
import { ArkhamClient } from './clients/arkham.js';
import { createRouter } from './api/routes.js';
import { EnrichedTrade, RawTrade } from './types/index.js';

// MongoDB and persistence
import { connectToMongoDB } from './db/index.js';
import { PersistenceService } from './services/persistenceService.js';
import { OutcomeTracker } from './services/outcomeTracker.js';
import { ClusterDetector } from './services/clusterDetector.js';
import { createMetricsRouter } from './api/metricsRoutes.js';

// =============================================================================
// Initialize Services
// =============================================================================

console.log('🐋 Starting Polymarket Whale Tracker...');

// Centralized version
const APP_VERSION = '2.0.0';

console.log(`   Environment: ${config.nodeEnv}`);
console.log(`   Whale Threshold: $${config.whaleThresholdUsd}`);
console.log(`   Insider Score Threshold: ${config.insiderScoreThreshold}`);

// Connect to MongoDB
connectToMongoDB().then(() => {
    console.log('📦 MongoDB connection initialized');
}).catch((_err) => {
    console.warn('📦 MongoDB not available, running in memory-only mode');
});

// Clients
const polygonRpc = new PolygonRpcClient();
const arkham = config.arkhamApiKey ? new ArkhamClient() : undefined;

// Polymarket profile client for wallet stats and noise detection
import { PolymarketProfileClient } from './clients/polymarketProfile.js';
const polymarketProfile = new PolymarketProfileClient();

// Order flow tracker for pattern detection
import { OrderFlowTracker } from './services/orderFlowTracker.js';
const orderFlowTracker = new OrderFlowTracker();

// Persistence and validation services
const persistenceService = new PersistenceService();
const outcomeTracker = new OutcomeTracker();
const clusterDetector = new ClusterDetector();

// Pre-announcement timing detection
import { PreAnnouncementTracker } from './services/preAnnouncementTracker.js';
const preAnnouncementTracker = new PreAnnouncementTracker();

// Core services
const insiderScorer = new InsiderScorer(polygonRpc, polymarketProfile, arkham, clusterDetector, orderFlowTracker, preAnnouncementTracker);
const walletProfiler = new WalletProfiler(polymarketProfile);
const marketService = new MarketService();
const tradeProcessor = new TradeProcessor(insiderScorer, walletProfiler, marketService, orderFlowTracker, polygonRpc);
const alertService = new AlertService();
const marketFetcher = new MarketFetcher();

// Send test alert on startup
alertService.sendTestMessage().catch(console.error);

// Start outcome tracking (polls for resolved markets every 15 min)
outcomeTracker.startPolling();

// Start pre-announcement timing checks (every 15 min)
const preAnnouncementInterval = setInterval(async () => {
    await preAnnouncementTracker.checkPriceMovements(async (marketId: string) => {
        const market = await marketService.getMarket(marketId);
        return market?.lastPrice ?? null;
    });
    preAnnouncementTracker.cleanup();
}, 15 * 60 * 1000);

// Periodic market discovery (every 30 mins)
// Scans for new active markets (Top 15k by volume) to add to subscription
// Also cleans up closed markets to prevent subscription bloat
const discoveryInterval = setInterval(async () => {
    console.log('🔍 Running periodic market discovery...');
    const startUsage = process.memoryUsage();
    const startCpu = process.cpuUsage();
    const startTime = Date.now();

    try {
        const newAssetIds = await marketFetcher.getTargetCategoryAssetIds();

        if (newAssetIds.length > 0) {
            // Check which of our subscribed assets are no longer active (closed markets)
            const subscribedAssets = polymarketWs.getSubscribedAssets();
            const nowClosed = subscribedAssets.filter(id => !newAssetIds.includes(id));

            if (nowClosed.length > 0) {
                console.log(`[Discovery] 🧹 Found ${nowClosed.length} closed markets (${((nowClosed.length / subscribedAssets.length) * 100).toFixed(1)}% of subscriptions)`);
            }

            // Decision: When to do full refresh vs incremental update
            const bloatPercentage = (nowClosed.length / subscribedAssets.length) * 100;
            const shouldRefresh = nowClosed.length >= 10 || bloatPercentage >= 50;

            if (shouldRefresh) {
                // Full refresh: disconnect and reconnect with only active markets
                console.log(`[Discovery] 🔄 Triggering full refresh (${nowClosed.length} closed markets to remove)`);
                await polymarketWs.refreshSubscriptions(newAssetIds);
                console.log(`✅ Subscription refresh complete. Now tracking: ${newAssetIds.length} markets`);
            } else {
                // Incremental update: just add new markets (keep old/closed ones for now)
                await polymarketWs.updateSubscriptions(newAssetIds);
                const totalAfter = polymarketWs.getSubscribedAssets().length;
                console.log(`✅ Market discovery complete. Total subscriptions: ${totalAfter}`);
            }
        } else {
            console.log('✅ Market discovery complete. No new assets found.');
        }
    } catch (error) {
        console.error('❌ Market discovery failed:', error);
    } finally {
        const endUsage = process.memoryUsage();
        const cpuDiff = process.cpuUsage(startCpu);
        const duration = Date.now() - startTime;
        const memoryDelta = (endUsage.heapUsed - startUsage.heapUsed) / 1024 / 1024;

        console.log(`[Perf] Discovery Loop: ${duration}ms | ` +
            `Mem Delta: ${memoryDelta.toFixed(2)}MB | ` +
            `CPU: ${cpuDiff.user / 1000}ms user`);
    }
}, 30 * 60 * 1000);

// Clean up on shutdown
process.on('SIGINT', () => {
    clearInterval(preAnnouncementInterval);
    clearInterval(discoveryInterval);
});

// Trade history (in-memory + MongoDB)
const tradeHistory = new Map<string, EnrichedTrade>();


// =============================================================================
// Express App Setup
// =============================================================================

import { createAdminRouter } from './api/adminRoutes.js';
import { apiLimiter, adminLimiter, tradeLimiter, metricsMiddleware, getMetrics, getMetricsContentType, validateWsToken, wsConnectionsGauge } from './middleware/index.js';
import { initRedis, isRedisConnected } from './cache/redis.js';
import { isMongoDBConnected } from './db/index.js';

// Initialize Redis cache (optional)
initRedis().catch(() => console.warn('[Redis] Running without cache'));

export const app = express();
const startTime = Date.now();

// Core middleware
app.use(cors());
app.use(express.json());
app.use(metricsMiddleware);

// Rate limiting
app.use('/api/admin', adminLimiter);
app.use('/api/trades', tradeLimiter);
app.use('/api', apiLimiter);

// API version constant
const API_VERSION = 'v1';

// API routes (versioned: /api/v1)
const router = createRouter(walletProfiler, marketService, tradeHistory);
const metricsRouter = createMetricsRouter(outcomeTracker);

app.use(`/api/${API_VERSION}`, router);
app.use(`/api/${API_VERSION}/metrics`, metricsRouter);

// Backwards compatibility: also mount at /api (deprecation warning in future)
app.use('/api', router);
app.use('/api/metrics', metricsRouter);
app.use('/api/admin', createAdminRouter(tradeHistory, insiderScorer));

// Health check endpoint
app.get('/health', (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const mongoConnected = isMongoDBConnected();
    const redisConnected = isRedisConnected();
    const wsConnected = polymarketWs?.isConnected() ?? false;

    const status = mongoConnected && wsConnected ? 'ok' :
        mongoConnected || wsConnected ? 'degraded' : 'unhealthy';

    res.status(status === 'unhealthy' ? 503 : 200).json({
        status,
        uptime,
        version: APP_VERSION,
        services: {
            mongodb: mongoConnected,
            redis: redisConnected,
            websocket: wsConnected,
        },
        stats: {
            tradesInMemory: tradeHistory.size,
            connectedClients: clients.size,
        },
    });
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
    try {
        const metrics = await getMetrics();
        res.set('Content-Type', getMetricsContentType());
        res.send(metrics);
    } catch (error) {
        res.status(500).json({ error: 'Failed to collect metrics' });
    }
});

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Root endpoint
app.get('/', (_req, res) => {
    res.json({
        name: 'Polymarket Whale Tracker',
        version: APP_VERSION,
        status: 'running',
        endpoints: {
            health: '/health',
            metrics: '/metrics',
            trades: '/api/trades',
            wallets: '/api/wallets',
            markets: '/api/markets',
            admin: '/api/admin/*',
            ethics: '/api/ethics/quote',
            stats: '/api/stats',
        },
    });
});

// =============================================================================
// HTTP & WebSocket Server
// =============================================================================

export const server = http.createServer(app);

// WebSocket server for frontend real-time updates
// Use verifyClient for proper URL access during handshake
const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, callback) => {
        // Extract token from URL during handshake (before upgrade)
        try {
            const url = new URL(info.req.url || '', `http://${info.req.headers.host || 'localhost'}`);
            const token = url.searchParams.get('token');

            if (token) {
                const auth = validateWsToken(token);
                if (!auth.valid) {
                    console.log('[WS-Server] Invalid token rejected during handshake');
                    callback(false, 401, 'Invalid authentication token');
                    return;
                }
                // Store permissions in headers for later access
                (info.req as unknown as Record<string, unknown>)._wsPermissions = auth.permissions;
            }
            callback(true);
        } catch (error) {
            console.error('[WS-Server] Error verifying client:', error);
            callback(true); // Allow connection on error, default to public
        }
    }
});

const clients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
    console.log('[WS-Server] Client connected');
    clients.add(ws);

    // Get permissions from verifyClient (stored during handshake)
    const reqWithPerms = request as unknown as Record<string, unknown>;
    const permissions: string[] = (reqWithPerms._wsPermissions as string[]) || ['public'];

    if (permissions.length > 1 || (permissions.length === 1 && permissions[0] !== 'public')) {
        console.log(`[WS-Server] Client authenticated with permissions: ${permissions.join(', ')}`);
    }

    wsConnectionsGauge.inc();

    ws.on('close', () => {
        console.log('[WS-Server] Client disconnected');
        clients.delete(ws);
        wsConnectionsGauge.dec();
    });

    ws.on('error', (error: Error) => {
        console.error('[WS-Server] Client error:', error.message);
        clients.delete(ws);
        wsConnectionsGauge.dec();
    });

    // Send initial stats
    ws.send(JSON.stringify({
        type: 'stats',
        data: {
            totalTrades: tradeHistory.size,
            connectedClients: clients.size,
        },
    }));
});


/**
 * Broadcast enriched trade to all connected clients and persist to MongoDB
 */
function broadcastTrade(trade: EnrichedTrade): void {
    // Save to MongoDB (async, non-blocking)
    persistenceService.saveTrade(trade).catch(err => {
        console.error('[Persistence] Failed to save trade:', err);
    });

    const message = JSON.stringify({
        type: 'trade',
        data: trade,
    });

    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

// =============================================================================
// Polymarket WebSocket Connection
// =============================================================================

const polymarketWs = new PolymarketWebSocket();

// Handle incoming trades
polymarketWs.on('trade', async (rawTrade: RawTrade) => {
    try {
        const enrichedTrade = await tradeProcessor.process(rawTrade);

        if (enrichedTrade) {
            // Store in history
            tradeHistory.set(enrichedTrade.id, enrichedTrade);

            // Limit history size
            if (tradeHistory.size > 1000) {
                const oldestKey = tradeHistory.keys().next().value;
                if (oldestKey) tradeHistory.delete(oldestKey);
            }

            // Log the trade
            const flagEmoji = enrichedTrade.isFlagged ? '🚨' : '🐋';
            console.log(
                `${flagEmoji} Trade: $${enrichedTrade.sizeUsd.toLocaleString()} | ` +
                `${enrichedTrade.side} | Score: ${enrichedTrade.insiderScore.breakdown.total}`
            );

            // Broadcast to connected clients
            broadcastTrade(enrichedTrade);

            // Send Discord alert if configured
            if (alertService.shouldAlert(enrichedTrade)) {
                await alertService.sendWhaleAlert(enrichedTrade);
            }

            // Track flagged trades for pre-announcement timing detection
            preAnnouncementTracker.recordEnrichedTrade(enrichedTrade);
        }
    } catch (error) {
        console.error('[Main] Error processing trade:', error);
    }
});

polymarketWs.on('connected', () => {
    console.log('✅ Connected to Polymarket WebSocket');
});

polymarketWs.on('disconnected', () => {
    console.log('⚠️ Disconnected from Polymarket WebSocket');
});

polymarketWs.on('error', (error) => {
    console.error('❌ Polymarket WebSocket error:', error);
});

// =============================================================================
// Start Server
// =============================================================================

export async function startServer(): Promise<void> {
    try {
        // Start HTTP server
        server.listen(config.port, () => {
            console.log(`🚀 Server running on http://localhost:${config.port}`);
            console.log(`   WebSocket: ws://localhost:${config.port}/ws`);
        });

        // Fetch active market asset IDs from Polymarket
        console.log('📡 Fetching active market asset IDs...');
        const assetIds = await marketFetcher.getTargetCategoryAssetIds();

        if (assetIds.length > 0) {
            console.log(`✅ Found ${assetIds.length} asset IDs for target categories`);
            await polymarketWs.connect(assetIds);
        } else {
            console.log('⚠️ No matching markets found. Trying all active markets...');
            const allAssetIds = await marketFetcher.getActiveAssetIds(100);

            if (allAssetIds.length > 0) {
                console.log(`✅ Found ${allAssetIds.length} asset IDs from active markets`);
                await polymarketWs.connect(allAssetIds);
            } else {
                console.log('⚠️ Could not fetch asset IDs. Running in API-only mode.');
                console.log('   Check your network connection and try restarting.');
            }
        }

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down...');
            polymarketWs.disconnect();
            server.close();
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
