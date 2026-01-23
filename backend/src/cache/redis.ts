/**
 * Redis Cache Layer
 * Caching for market data and wallet profiles
 */
import Redis from 'ioredis';
import { cacheHitCounter, cacheMissCounter } from '../middleware/metrics.js';

// ============================================================================
// Redis Client
// ============================================================================

let redis: Redis | null = null;
let isRedisEnabled = false;

/**
 * Initialize Redis connection
 */
export async function initRedis(): Promise<boolean> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisEnabled = process.env.REDIS_ENABLED !== 'false';

    if (!redisEnabled) {
        console.log('[Redis] Caching disabled via REDIS_ENABLED=false');
        return false;
    }

    try {
        redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 3) {
                    console.warn('[Redis] Max retries reached, disabling cache');
                    isRedisEnabled = false;
                    return null; // Stop retrying
                }
                return Math.min(times * 200, 1000);
            },
            lazyConnect: true,
        });

        await redis.ping();
        isRedisEnabled = true;
        console.log('[Redis] Connected successfully');
        return true;
    } catch (error) {
        console.warn('[Redis] Connection failed, caching disabled:', error);
        isRedisEnabled = false;
        redis = null;
        return false;
    }
}

/**
 * Check if Redis is available
 */
export function isRedisConnected(): boolean {
    return isRedisEnabled && redis !== null;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
    if (redis) {
        try {
            if (redis.status !== 'end') {
                await redis.quit();
            }
        } catch (error) {
            // Provide silent fallback for cleanup
            // console.warn('[Redis] Error during close:', error); 
        }
        redis = null;
        isRedisEnabled = false;
    }
}

export const disconnectRedis = closeRedis;

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Get value from cache
 */
export async function cacheGet<T>(key: string, cacheType = 'default'): Promise<T | null> {
    if (!isRedisEnabled || !redis) {
        return null;
    }

    try {
        const value = await redis.get(key);
        if (value) {
            cacheHitCounter.inc({ cache_type: cacheType });
            return JSON.parse(value) as T;
        }
        cacheMissCounter.inc({ cache_type: cacheType });
        return null;
    } catch (error) {
        console.error('[Redis] Get error:', error);
        return null;
    }
}

/**
 * Set value in cache with TTL
 */
export async function cacheSet(
    key: string,
    value: unknown,
    ttlSeconds: number = 300
): Promise<boolean> {
    if (!isRedisEnabled || !redis) {
        return false;
    }

    try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        return true;
    } catch (error) {
        console.error('[Redis] Set error:', error);
        return false;
    }
}

/**
 * Delete value from cache
 */
export async function cacheDel(key: string): Promise<boolean> {
    if (!isRedisEnabled || !redis) {
        return false;
    }

    try {
        await redis.del(key);
        return true;
    } catch (error) {
        console.error('[Redis] Del error:', error);
        return false;
    }
}

/**
 * Delete keys matching pattern
 */
export async function cacheDelPattern(pattern: string): Promise<number> {
    if (!isRedisEnabled || !redis) {
        return 0;
    }

    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        return keys.length;
    } catch (error) {
        console.error('[Redis] Del pattern error:', error);
        return 0;
    }
}

/**
 * Get or fetch with cache
 * If key exists in cache, return it. Otherwise, fetch and cache.
 */
export async function cacheGetOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = 300,
    cacheType = 'default'
): Promise<T> {
    // Try cache first
    const cached = await cacheGet<T>(key, cacheType);
    if (cached !== null) {
        return cached;
    }

    // Fetch fresh data
    const fresh = await fetcher();

    // Cache for next time
    await cacheSet(key, fresh, ttlSeconds);

    return fresh;
}

// ============================================================================
// Cache Keys
// ============================================================================

export const CacheKeys = {
    // Market data - 5 min TTL
    market: (marketId: string) => `market:${marketId}`,
    marketCategory: (marketId: string) => `market:category:${marketId}`,

    // Wallet profiles - 10 min TTL
    walletProfile: (address: string) => `wallet:profile:${address.toLowerCase()}`,
    walletTrades: (address: string) => `wallet:trades:${address.toLowerCase()}`,

    // Stats - 1 min TTL
    globalStats: () => 'stats:global',
    adminStats: () => 'stats:admin',

    // Factor breakdown - 5 min TTL
    factorBreakdown: () => 'analysis:factors',
};

export const CacheTTL = {
    market: 300,        // 5 minutes
    walletProfile: 600, // 10 minutes
    stats: 60,          // 1 minute
    factors: 300,       // 5 minutes
};

// ============================================================================
// Trade Velocity Tracking (for insider detection)
// Uses Redis sorted sets to track trade timestamps per wallet.
// ============================================================================

import { config } from '../config/index.js';

/**
 * Record a trade for velocity tracking.
 * Stores timestamp in a sorted set with automatic cleanup of old entries.
 */
export async function recordTradeForVelocity(walletAddress: string): Promise<void> {
    if (!isRedisEnabled || !redis) return;

    const key = `velocity:${walletAddress.toLowerCase()}`;
    const now = Date.now();
    // Convert seconds to ms
    const windowMs = (config.detection?.velocityWindowSec || 60) * 1000;

    try {
        // Add current timestamp
        await redis.zadd(key, now, `${now}`);
        // Remove entries older than the window
        await redis.zremrangebyscore(key, 0, now - windowMs);
        // Set TTL so we don't keep stale keys forever (2x window size)
        await redis.expire(key, Math.ceil(windowMs / 1000) * 2);
    } catch (err) {
        // Non-critical. If Redis hiccups, we just miss this data point.
    }
}

/**
 * Get trade count in the velocity window for a wallet.
 * Returns 0 if Redis unavailable (fail-open).
 */
export async function getTradeVelocity(walletAddress: string): Promise<number> {
    if (!isRedisEnabled || !redis) return 0;

    const key = `velocity:${walletAddress.toLowerCase()}`;
    const now = Date.now();
    // Convert seconds to ms
    const windowMs = (config.detection?.velocityWindowSec || 60) * 1000;

    try {
        return await redis.zcount(key, now - windowMs, now);
    } catch (err) {
        return 0;
    }
}

