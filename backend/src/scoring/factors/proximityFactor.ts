/**
 * Event Proximity Factor - Boosts score for trades near resolution
 * 
 * Trades placed close to an event's resolution time are more likely
 * to reflect insider knowledge. Someone who knows what's about to happen
 * waits until the last moment then bets big.
 */

import { config } from '../../config/index.js';

const MAX_PROXIMITY_POINTS = 15;

/**
 * Score based on proximity to market resolution.
 * If endDate is within the proximity window, add bonus points.
 * 
 * @param endDate - Market resolution date (null if unknown)
 * @param tradeTimestamp - When the trade happened
 */
export function scoreEventProximity(
    endDate: Date | null,
    tradeTimestamp: Date
): number {
    if (!endDate) return 0;  // No end date = can't score

    const hoursToResolution = (endDate.getTime() - tradeTimestamp.getTime()) / (1000 * 60 * 60);
    const threshold = config.detection.eventProximityHours;

    // Only score if trading BEFORE resolution (not after)
    if (hoursToResolution < 0) return 0;

    if (hoursToResolution <= 6) {
        // Last 6 hours: full points
        return MAX_PROXIMITY_POINTS;
    } else if (hoursToResolution <= 12) {
        return 10;
    } else if (hoursToResolution <= threshold) {
        return 5;
    }

    return 0;
}
