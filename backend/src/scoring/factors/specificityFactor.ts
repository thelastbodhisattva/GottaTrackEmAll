/**
 * Specificity Scoring Factor (10 pts max)
 * Precise date outcomes, specific events, narrow predictions
 */
import { Trade, WalletProfile } from '../../types/index.js';
import { PolymarketProfileClient } from '../../clients/polymarketProfile.js';

/**
 * Factor 6: Trade Specificity (10 pts max)
 * Precise date outcomes, specific events, or narrow predictions
 */
export async function scoreSpecificity(
    trade: Trade,
    walletProfile: WalletProfile | null,
    polymarketProfile: PolymarketProfileClient
): Promise<number> {
    const title = trade.marketTitle.toLowerCase();
    let score = 0;

    // Highly specific date patterns (10 pts)
    const datePatterns = [
        /by (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d+/i,
        /before (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d+/i,
        /on (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d+/i,
        /\d{1,2}\/\d{1,2}\/\d{2,4}/,
        /\d{4}-\d{2}-\d{2}/,
        /by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
        /this (week|weekend|month)/i,
        /end of (january|february|march|april|may|june|july|august|september|october|november|december)/i,
    ];

    for (const pattern of datePatterns) {
        if (pattern.test(title)) {
            return 10; // Date-specific = max specificity
        }
    }

    // Specific event patterns (8 pts)
    const eventPatterns = [
        /\b(resign|impeach|indict|arrest|announce|win|lose|defeat|confirm|nominate|pardon|fire|hire|appoint)\b/i,
        /\b(election|primary|debate|vote|nomination|inauguration|term|strikes|iran|greenland|nuclear|presidency)\b/i,
        /\b(trump|biden|harris|musk|bezos|putin|zelensky|netanyahu|xi|macron|starmer)\b/i,
        /\b(bitcoin|btc|eth|ethereum|solana|sol|xrp|doge)\b.*\$?\d+k?/i,
        /\$\d+[km]?\s*(btc|bitcoin|eth|ethereum)?/i,
        /\b(rate\s*(cut|hike)|fed\s*(rate|funds)|interest\s+rate|inflation|gdp|unemployment|recession)\b/i,
        /\b(ipo|merger|acquisition|bankruptcy|sec|lawsuit|settlement)\b/i,
        /\b(super\s*bowl|world\s*cup|finals|championship|playoffs|oscar|grammy|emmy)\b/i,
        /\bvs\.?\s+\w+/i,
        /\b(launch|release|announce|reveal|unveil|ship)\b.*\b(202\d)\b/i,
        /\b(ai|gpt|model|chip|product|iphone|tesla|spacex)\b/i,
    ];

    for (const pattern of eventPatterns) {
        if (pattern.test(title)) {
            score = Math.max(score, 8);
            break;
        }
    }

    // Numeric outcomes (5 pts)
    const numericPatterns = [
        /\b(above|below|over|under|reach|hit|exceed|surpass)\s+\$?\d+/i,
        /\b\d+%/i,
        /\b(more|less|fewer|at\s+least|at\s+most)\s+than\s+\d+/i,
        /\b\d+\s*(million|billion|k|m|b)\b/i,
        /\bby\s+q[1-4]/i,
    ];

    for (const pattern of numericPatterns) {
        if (pattern.test(title)) {
            score = Math.max(score, 5);
            break;
        }
    }

    // Year-specific markets
    const currentYear = new Date().getFullYear();
    const yearMatch = title.match(/\b(202\d)\b/);
    if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        if (year === currentYear || year === currentYear + 1) {
            score = Math.max(score, 3);
        } else {
            score = Math.max(score, 5);
        }
    }

    // Niche overlap penalty
    let nichePenalty = 0;
    if (trade.walletAddress && trade.walletAddress !== 'Unknown') {
        try {
            if (walletProfile && walletProfile.marketsTraded && walletProfile.marketsTraded.length >= 5) {
                const activity = await polymarketProfile.getWalletActivity(trade.walletAddress, 50);
                if (activity && activity.trades.length >= 5) {
                    const totalTrades = activity.trades.length;
                    const smallBets = activity.trades.filter(t => t.size < 100).length;
                    const noisePercent = smallBets / totalTrades;

                    if (noisePercent > 0.5) {
                        nichePenalty = 2;
                    } else if (noisePercent > 0.3) {
                        nichePenalty = 1;
                    }
                }
            }
        } catch {
            // Ignore errors
        }
    }

    score = Math.max(0, score - nichePenalty);

    if (score > 0) {
        console.log(`[SpecificityFactor] Specific market detected (score=${score}): "${trade.marketTitle.slice(0, 50)}..."`);
    }

    return score;
}
