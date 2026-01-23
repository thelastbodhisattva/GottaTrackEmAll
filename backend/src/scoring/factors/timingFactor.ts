/**
 * Timing Scoring Factor (40 pts max)
 * Combines time-to-close, hour-of-day, and weekend patterns
 */
import { Trade } from '../../types/index.js';
import { PreAnnouncementTracker } from '../../services/preAnnouncementTracker.js';

/**
 * Factor 3: Timing (40 pts max)
 * Combines:
 * - Time-to-market-close (exponential decay: bets closer to resolution are more suspicious)
 * - Hour-of-day heuristics (late night/early morning = potential non-US insiders)
 * - Weekend bonus (less noise from regular traders)
 * - Pre-odds-shift detection
 */
export function scoreTiming(trade: Trade, preAnnouncementTracker?: PreAnnouncementTracker): number {
    let score = 0;

    // 1. Time-to-market-close scoring (20 pts max) - exponential decay
    // Bets placed closer to market resolution are more suspicious
    if (trade.marketEndDate) {
        const hoursToClose = (trade.marketEndDate.getTime() - trade.timestamp.getTime()) / (1000 * 60 * 60);

        if (hoursToClose > 0 && hoursToClose <= 168) { // Within 7 days of close
            // Exponential decay: 20 * e^(-hours/24) 
            // At 0h: ~20pts, at 6h: ~15pts, at 24h: ~7pts, at 48h: ~3pts
            const timeScore = Math.round(20 * Math.exp(-hoursToClose / 24));
            score += timeScore;

            if (timeScore >= 10) {
                const daysToClose = hoursToClose / 24;
                console.log(`[TimingFactor] Late-stage bet: ${daysToClose.toFixed(1)} days before close (timing: +${timeScore}pts)`);
            }
        }
    }

    // 2. Hour-of-day heuristics (5 pts max)
    // Late night/early morning trades in UTC = potential non-US informed traders
    const hour = trade.timestamp.getUTCHours();
    if (hour >= 22 || hour <= 4) {
        score += 5;
    } else if (hour >= 20 || hour <= 6) {
        score += 3;
    }

    // 3. Weekend trading bonus (5 pts)
    // Less noise from regular traders, higher signal-to-noise ratio
    const dayOfWeek = trade.timestamp.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        score += 5;
    }

    // 4. Pre-odds-shift detection (10 pts max)
    // Detect if odds moved significantly (>5%) in 30-60 min before this trade
    // and the trade is betting in the direction of the move
    if (preAnnouncementTracker && trade.marketId && trade.price && trade.side) {
        // Record this trade's price for future reference
        preAnnouncementTracker.recordPriceSnapshot(trade.marketId, trade.price);

        // Check for pre-trade odds shift
        const preOddsShiftScore = preAnnouncementTracker.detectPreOddsShift(
            trade.marketId,
            trade.price,
            trade.side
        );
        score += preOddsShiftScore;
    }

    const finalScore = Math.min(40, score); // Raised cap to 40 for pre-odds shift
    if (finalScore >= 15) {
        console.log(`[TimingFactor] High timing score: ${finalScore}/40 (hour=${hour}, weekend=${dayOfWeek === 0 || dayOfWeek === 6})`);
    }

    return finalScore;
}
