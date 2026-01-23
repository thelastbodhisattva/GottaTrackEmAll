/**
 * Connections Scoring Factor (20 pts max)
 * Win rate, PnL stability, shared funding with flagged wallets
 */
import { WalletProfile } from '../../types/index.js';
import { ClusterDetector } from '../../services/clusterDetector.js';
import { isMongoDBConnected } from '../../db/index.js';

/**
 * Count how many connected wallets have been flagged in recent trades
 */
export async function countFlaggedConnections(walletAddresses: string[], threshold: number): Promise<number> {
    if (!isMongoDBConnected()) return 0;

    try {
        const { Trade: TradeMongo } = await import('../../db/index.js');
        const flaggedTrades = await TradeMongo.countDocuments({
            walletAddress: { $in: walletAddresses },
            'insiderScore.breakdown.total': { $gte: threshold },
            timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        });
        return Math.min(3, flaggedTrades);
    } catch (error) {
        console.error('[ConnectionsFactor] Error in countFlaggedConnections:', error);
        return 0;
    }
}

/**
 * Factor 8: Wallet Connections (20 pts max)
 * Based on PnL stability and win rate (indicating repeated insider access)
 */
export async function scoreConnections(
    wallet: string,
    profile: WalletProfile | null,
    threshold: number,
    clusterDetector?: ClusterDetector
): Promise<number> {
    try {
        if (!profile || profile.totalTrades < 5) {
            return 0; // Not enough history to evaluate
        }

        let score = 0;

        // Win rate scoring (10 pts max)
        // >70% win rate = insider indicator
        if (profile.winRate > 0.7) {
            score += 10;
            console.log(`[InsiderScorer] High win rate: ${(profile.winRate * 100).toFixed(0)}% over ${profile.totalTrades} trades (+10)`);
        } else if (profile.winRate > 0.55) {
            score += 5;
        }

        // PnL stability (5 pts max)
        if (profile.totalPnl > 1000 && profile.totalTrades >= 10) {
            score += 5;
            console.log(`[ConnectionsFactor] Strong PnL: $${profile.totalPnl.toFixed(0)} over ${profile.totalTrades} trades (+5)`);
        } else if (profile.totalPnl > 500) {
            score += 3;
        }

        // Shared funding source with flagged wallets (+5 pts)
        if (clusterDetector) {
            const clusterAnalysis = await clusterDetector.analyzeCluster(wallet);
            if (clusterAnalysis.connectedWallets.length > 0) {
                const connectedFlaggedCount = await countFlaggedConnections(clusterAnalysis.connectedWallets, threshold);
                if (connectedFlaggedCount > 0) {
                    const fundingBonus = Math.min(5, connectedFlaggedCount * 2);
                    score += fundingBonus;
                    console.log(`[ConnectionsFactor] 🔗 Shared funding with ${connectedFlaggedCount} flagged wallet(s) (+${fundingBonus})`);
                }
            }
        }

        return Math.min(20, score);
    } catch (error) {
        console.error('[ConnectionsFactor] Error:', error);
        return 0;
    }
}
