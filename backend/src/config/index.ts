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
} as const;

export type Config = typeof config;
