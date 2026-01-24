/**
 * Correlated Bets Scoring Factor (15 pts max)
 * Rewards wallets that maintain logically consistent positions across related markets
 */
import { Trade, WalletProfile } from '../../types/index.js';
import { CorrelationDetector, CorrelationSignal } from '../../services/correlationDetector.js';

/**
 * Score correlated bets across related markets
 * 
 * Points breakdown:
 * - 10 pts: Logically consistent positions found
 * - 5 pts: Related positions exist but consistency unclear
 * - 0 pts: No related positions found
 * 
 * @param trade Current trade being processed
 * @param walletProfile Wallet's trading profile
 * @param correlationDetector Service for detecting market correlations
 */
export async function scoreCorrelatedBets(
    trade: Trade,
    walletProfile: WalletProfile | null,
    correlationDetector: CorrelationDetector
): Promise<{ score: number; signal: CorrelationSignal | null }> {
    try {
        // Need wallet address to check positions
        if (!trade.walletAddress) {
            return { score: 0, signal: null };
        }

        // Check for correlated positions
        const signal = await correlationDetector.checkCorrelatedPositions(
            trade.walletAddress,
            trade.marketId,
            trade.side
        );

        if (!signal) {
            return { score: 0, signal: null };
        }

        // Score based on correlation strength and logical consistency
        let score = 0;

        if (signal.logicallyConsistent) {
            // High score for consistent positions (indicates informed betting)
            score = 10;
            console.log(
                `[CorrelatedBetsFactor] ✅ Consistent positions: ` +
                `${trade.side} on current + ${signal.walletSide} on "${signal.relatedMarketQuestion.slice(0, 40)}..." (+10)`
            );
        } else {
            // Moderate score for related but inconsistent positions (possible hedging)
            score = 5;
            console.log(
                `[CorrelatedBetsFactor] ⚠️ Hedged position: ` +
                `${trade.side} on current + ${signal.walletSide} on "${signal.relatedMarketQuestion.slice(0, 40)}..." (+5)`
            );
        }

        // Bonus for high correlation strength
        if (signal.correlationStrength >= 0.7) {
            score += 3;
            console.log(`[CorrelatedBetsFactor] 🔗 High correlation strength: ${(signal.correlationStrength * 100).toFixed(0)}% (+3)`);
        }

        // Additional bonus if wallet has limited history (new wallet with correlated positions = very suspicious)
        if (walletProfile && walletProfile.totalTrades <= 5) {
            score += 2;
            console.log(`[CorrelatedBetsFactor] 🆕 New wallet with correlated positions (+2)`);
        }

        return {
            score: Math.min(15, score),
            signal,
        };
    } catch (error) {
        console.error('[CorrelatedBetsFactor] Error:', error);
        return { score: 0, signal: null };
    }
}
