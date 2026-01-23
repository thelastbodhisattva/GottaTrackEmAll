/**
 * Velocity Factor - Detects burst trading patterns
 * 
 * High-frequency trading from a single wallet often signals informed trading.
 * Someone building a position quickly before news drops won't spread trades
 * over days. This factor catches that pattern.
 */

import { config } from '../../config/index.js';
import { getTradeVelocity } from '../../cache/redis.js';

const MAX_VELOCITY_POINTS = 15;

/**
 * Score based on trade velocity (trades per minute).
 * More trades in quick succession = higher score.
 * Returns 0-15 points.
 */
export async function scoreTradeVelocity(walletAddress: string): Promise<number> {
    const velocity = await getTradeVelocity(walletAddress);
    const threshold = config.detection.maxTradesPerMin;

    if (velocity <= 1) return 0;  // One trade is normal
    if (velocity <= 2) return 3;  // Slightly elevated
    if (velocity <= threshold) return 7;  // Getting suspicious

    // Over threshold: full points
    return MAX_VELOCITY_POINTS;
}
