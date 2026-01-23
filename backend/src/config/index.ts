import dotenv from 'dotenv';
dotenv.config();

export const config = {
    // Server
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // MongoDB
    mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/whale-tracker',

    // Redis
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

    // Polymarket
    polymarket: {
        wsUrl: process.env.POLYMARKET_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
        apiUrl: process.env.POLYMARKET_API_URL || 'https://clob.polymarket.com',
    },

    // Polygonscan
    polygonscanApiKey: process.env.POLYGONSCAN_API_KEY || '',

    // Alchemy (Polygon RPC for on-chain lookups)
    alchemyApiKey: process.env.ALCHEMY_API_KEY || '',

    // Arkham (Optional)
    arkhamApiKey: process.env.ARKHAM_API_KEY || '',

    // Discord
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',

    // Thresholds
    whaleThresholdUsd: parseInt(process.env.WHALE_THRESHOLD_USD || '1000', 10),
    insiderScoreThreshold: parseInt(process.env.INSIDER_SCORE_THRESHOLD || '65', 10),

    // Logging
    logVerbose: process.env.LOG_VERBOSE === 'true',

    // Target market categories (all categories enabled for whale alerts)
    targetCategories: ['geopolitics', 'war', 'crypto', 'sports', 'esports', 'popculture', 'entertainment', 'science', 'other'] as const,

    // ==========================================================================
    // Scoring Constants (extracted from insiderScorer.ts)
    // ==========================================================================
    scoring: {
        /** Max possible raw score before normalization */
        maxRawScore: 240,
        /** Low volume market daily threshold in USD */
        lowVolumeThreshold: 10000,
        /** Additional score required for low-volume markets */
        lowVolumeScoreBonus: 10,
    },

    // ==========================================================================
    // Memory/Cache Limits
    // ==========================================================================
    limits: {
        /** Max trades in memory history */
        tradeHistorySize: 1000,
        /** Max wallets in profiler cache */
        walletStoreSize: 5000,
        /** Max processed trade IDs to track (for replay protection) */
        processedTradeIdsSize: 10000,
        /** How long to keep processed trade IDs (ms) - 1 hour */
        processedTradeIdsTtl: 60 * 60 * 1000,
    },

    // ==========================================================================
    // Cluster Detection
    // ==========================================================================
    cluster: {
        /** Time window for synchronized trade detection (ms) - 30 minutes */
        syncWindowMs: 30 * 60 * 1000,
        /** Minimum days to consider wallet "fresh" */
        freshWalletAgeDays: 7,
        /** Minimum trades for wallet to not be "fresh" */
        freshWalletMinTrades: 10,
        /** Minimum fresh wallets to detect cluster */
        clusterMinWallets: 3,
        /** Volume threshold for split bets bonus */
        splitBetsVolumeThreshold: 20000,
    },

    // ==========================================================================
    // Retry Configuration
    // ==========================================================================
    retry: {
        /** Maximum retries for Discord webhooks */
        discordMaxRetries: 3,
        /** Base delay for exponential backoff (ms) */
        baseDelayMs: 1000,
    },

    // ==========================================================================
    // Detection Improvements
    // These thresholds tune the insider detection algorithm.
    // Tweak based on observed false positive/negative rates.
    // ==========================================================================
    detection: {
        /** Wallet age (days) below which a wallet is "fresh" and gets flagged */
        minWalletAgeDays: parseInt(process.env.MIN_WALLET_AGE_DAYS || '30', 10),
        /** Min trades in last 7 days for wallet to be "active" (below = dormant) */
        minRecentTrades: parseInt(process.env.MIN_RECENT_TRADES || '3', 10),
        /** Max trades per minute before velocity flag triggers */
        maxTradesPerMin: parseInt(process.env.MAX_TRADES_PER_MIN || '5', 10),
        /** Window size for velocity tracking (seconds) */
        velocityWindowSec: parseInt(process.env.VELOCITY_WINDOW_SEC || '60', 10),
        /** Hours before event resolution to boost insider score */
        eventProximityHours: parseInt(process.env.EVENT_PROXIMITY_HOURS || '24', 10),
        /** Points added when trade is within proximity window */
        eventProximityBonus: parseInt(process.env.EVENT_PROXIMITY_BONUS || '15', 10),
    },
} as const;

export type Config = typeof config;

