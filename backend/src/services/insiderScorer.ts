import { config } from '../config/index.js';
import {
    Trade,
    InsiderScore,
    ScoreBreakdown,
    ConfidenceLevel,
    WalletProfile,
} from '../types/index.js';
import { PolygonRpcClient } from '../clients/polygonRpc.js';
import { PolymarketProfileClient } from '../clients/polymarketProfile.js';
import { ArkhamClient } from '../clients/arkham.js';
import { HansonQuotes } from '../utils/hansonQuotes.js';
import { ClusterDetector } from './clusterDetector.js';
import { OrderFlowTracker } from './orderFlowTracker.js';
import { PreAnnouncementTracker } from './preAnnouncementTracker.js';
import { isMongoDBConnected } from '../db/index.js';

// Import extracted scoring factors for cleaner, testable code
import {
    scoreWalletAge as factorWalletAge,
    scoreTradeSize as factorTradeSize,
    scoreTiming as factorTiming,
    scoreDiversification as factorDiversification,
    scoreOnChainSource as factorOnChainSource,
    scoreSpecificity as factorSpecificity,
    scoreImpact as factorImpact,
    scoreConnections as factorConnections,
} from '../scoring/factors/index.js';

/**
 * 10-Factor Insider Detection Scoring Algorithm (Phase 2)
 * 
 * Composite score (0-100) with weighted factors:
 * - Wallet Age: 25 pts max (fresh wallet + wc/tx timing)
 * - Trade Size: 20 pts max (abnormally large trades)
 * - Timing: 40 pts max (pre-news timing + pre-odds-shift detection)
 * - Diversification: 30 pts max (concentration + cross-market correlation + masking)
 * - On-Chain Source: 15 pts max (CEX deposits, dormant reactivation)
 * - Specificity: 10 pts max (date-specific outcomes)
 * - Impact: 10 pts max (low-liquidity whale + volume dominance)
 * - Connections: 20 pts max (win rate + PnL stability + shared funding)
 * - Order Flow: 10 pts max (accumulation patterns)
 * - Cluster: 30 pts max (fresh wallet cluster + split bets volume bonus)
 * 
 * Total max: 210 pts, normalized to 0-100
 * Threshold: >configurable flags as "potential high-info trade" (default 58)
 * 
 * Scoring logic has been extracted to: ../scoring/factors/
 */
export class InsiderScorer {
    private readonly threshold: number;
    private clusterDetector?: ClusterDetector;
    private orderFlowTracker?: OrderFlowTracker;
    private preAnnouncementTracker?: PreAnnouncementTracker;

    // Error tracking for monitoring silent failures
    private errorStats = {
        diversificationErrors: 0,
        onChainErrors: 0,
        connectionErrors: 0,
        clusterErrors: 0,
        lastError: null as string | null,
        lastErrorTime: null as Date | null,
    };

    constructor(
        private polygonRpc: PolygonRpcClient,
        private polymarketProfile: PolymarketProfileClient,
        private arkham?: ArkhamClient,
        clusterDetector?: ClusterDetector,
        orderFlowTracker?: OrderFlowTracker,
        preAnnouncementTracker?: PreAnnouncementTracker
    ) {
        this.threshold = config.insiderScoreThreshold;
        this.clusterDetector = clusterDetector;
        this.orderFlowTracker = orderFlowTracker;
        this.preAnnouncementTracker = preAnnouncementTracker;
    }

    /**
     * Get error statistics for monitoring
     */
    getErrorStats(): typeof this.errorStats {
        return { ...this.errorStats };
    }

    /**
     * Record an error for tracking
     */
    private recordError(factor: 'diversification' | 'onChain' | 'connection' | 'cluster', error: unknown): void {
        if (factor === 'diversification') this.errorStats.diversificationErrors++;
        else if (factor === 'onChain') this.errorStats.onChainErrors++;
        else if (factor === 'connection') this.errorStats.connectionErrors++;
        else if (factor === 'cluster') this.errorStats.clusterErrors++;

        this.errorStats.lastError = error instanceof Error ? error.message : String(error);
        this.errorStats.lastErrorTime = new Date();
    }

    /**
     * Calculate insider score for a trade
     * @param trade - The trade to score
     * @param preloadedProfile - Optional pre-fetched wallet profile to avoid duplicate API calls
     */
    async calculateScore(trade: Trade, preloadedProfile?: WalletProfile | null): Promise<InsiderScore> {
        // Pre-fetch wallet data ONCE to avoid duplicate API calls
        // Use EOA for on-chain lookups (first tx time)
        const eoaAddress = trade.walletAddress;
        // Use PROXY for Polymarket profile lookups (profiles are indexed by proxy)
        const profileAddress = trade.proxyWalletAddress || trade.walletAddress;

        // Use preloaded profile if provided, otherwise fetch with PROXY address
        const [walletProfile, firstTxTime] = await Promise.all([
            preloadedProfile !== undefined
                ? Promise.resolve(preloadedProfile)
                : this.polymarketProfile.getWalletProfile(profileAddress),
            this.polygonRpc.getWalletFirstTxTime(eoaAddress),
        ]);

        // DEBUG: Check what data we actually got (only in verbose mode)
        if (config.logVerbose) {
            if (!firstTxTime) console.log(`[InsiderScorer] ⚠️ firstTxTime is null/undefined for ${eoaAddress?.slice(0, 10)}...`);
            else console.log(`[InsiderScorer] First TX: ${new Date(firstTxTime).toISOString()}`);

            if (!walletProfile) console.log(`[InsiderScorer] ⚠️ walletProfile is null for ${profileAddress?.slice(0, 10)}...`);
            else console.log(`[InsiderScorer] Profile: ${walletProfile.totalTrades} trades, ${walletProfile.marketsTraded.length} markets`);

            if (!trade.marketEndDate) console.log(`[InsiderScorer] ⚠️ marketEndDate is missing for ${trade.marketTitle}`);
        }

        // Calculate all factors in parallel where possible, passing cached data
        const [
            diversificationScore,
            onChainScore,
            timingScore,
            impactScore,
            connectionsScore,
            walletAgeScore,
            specificityScore,
        ] = await Promise.all([
            // Use extracted factor functions with error handling
            factorDiversification(profileAddress, walletProfile, this.polymarketProfile, trade)
                .catch(e => { this.recordError('diversification', e); return 0; }),
            factorOnChainSource(trade, firstTxTime, this.polygonRpc, this.arkham)
                .catch(e => { this.recordError('onChain', e); return 0; }),
            Promise.resolve(factorTiming(trade, this.preAnnouncementTracker)),
            Promise.resolve(factorImpact(trade)),
            factorConnections(profileAddress, walletProfile, this.threshold, this.clusterDetector)
                .catch(e => { this.recordError('connection', e); return 0; }),
            Promise.resolve(factorWalletAge(trade, firstTxTime)),
            factorSpecificity(trade, walletProfile, this.polymarketProfile),
        ]);

        // Cluster detection (requires MongoDB)
        let clusterScore = 0;
        try {
            if (this.clusterDetector && trade.marketId && trade.side) {
                const clusterResult = await this.clusterDetector.detectFreshWalletCluster(
                    trade.marketId,
                    trade.side,
                    eoaAddress
                );
                clusterScore = clusterResult.clusterScore;
            }
        } catch (error) {
            console.error('[InsiderScorer] Error in cluster detection:', error);
            this.recordError('cluster', error);
        }

        // OrderFlow pattern detection
        let orderFlowScore = 0;
        if (this.orderFlowTracker) {
            const orderFlowResult = this.orderFlowTracker.analyzePatterns(trade);
            orderFlowScore = Math.min(10, orderFlowResult.score); // Cap at 10 for breakdown
        }

        const breakdown: ScoreBreakdown = {
            walletAge: walletAgeScore,
            tradeSize: factorTradeSize(trade), // Use extracted factor
            timing: timingScore,
            diversification: diversificationScore,
            onChainSource: onChainScore,
            specificity: specificityScore,
            impact: impactScore,
            connections: connectionsScore,
            orderFlow: orderFlowScore,
            cluster: clusterScore,
            total: 0,
        };

        // Calculate raw total and normalize to 0-100
        // Max: walletAge(25) + tradeSize(20) + timing(40) + diversification(30) + 
        //      onChainSource(15) + specificity(10) + impact(10) + connections(20) + 
        //      orderFlow(10) + cluster(30) = 210
        const rawTotal =
            breakdown.walletAge +
            breakdown.tradeSize +
            breakdown.timing +
            breakdown.diversification +
            breakdown.onChainSource +
            breakdown.specificity +
            breakdown.impact +
            breakdown.connections +
            breakdown.orderFlow +
            breakdown.cluster;

        breakdown.total = Math.min(100, Math.round((rawTotal / 210) * 100));

        // DEBUG: Log score breakdown (only in verbose mode)
        if (config.logVerbose) {
            console.log(`[InsiderScorer] Score breakdown for ${trade.walletAddress?.slice(0, 10) || 'Unknown'}...:`);
            console.log(`  walletAge: ${breakdown.walletAge}/25, tradeSize: ${breakdown.tradeSize}/20, timing: ${breakdown.timing}/40`);
            console.log(`  diversification: ${breakdown.diversification}/30, onChain: ${breakdown.onChainSource}/15, specificity: ${breakdown.specificity}/10`);
            console.log(`  impact: ${breakdown.impact}/10, connections: ${breakdown.connections}/20, orderFlow: ${breakdown.orderFlow}/10, cluster: ${breakdown.cluster}/30`);
            console.log(`  => Raw: ${rawTotal}/210, Final: ${breakdown.total}/100`);
        }

        // Low-volume market filter: Require higher score in thin markets to avoid noise
        // In low-liquidity markets, "unusual" activity is often just thin trading noise
        let effectiveThreshold = this.threshold;
        const dailyVolume = trade.marketAvgVolume || 0;

        if (dailyVolume > 0 && dailyVolume < 10000) { // <$10K daily volume
            effectiveThreshold = this.threshold + 10; // Require higher score for low-volume markets
            console.log(`[InsiderScorer] Low-volume market ($${dailyVolume.toFixed(0)}/day): raising threshold to ${effectiveThreshold}`);
        }

        const isFlagged = breakdown.total > effectiveThreshold;

        return {
            breakdown,
            isFlagged,
            confidence: this.getConfidenceLevel(breakdown.total),
            ethicsNote: isFlagged ? HansonQuotes.getNoteForScore(breakdown.total) : '',
            calculatedAt: new Date(),
        };
    }

    /**
     * Count how many connected wallets have been flagged in recent trades
     */
    private async countFlaggedConnections(walletAddresses: string[]): Promise<number> {
        if (!isMongoDBConnected()) return 0;

        try {
            // Check recent trades from these wallets for high scores
            const { Trade: TradeMongo } = await import('../db/index.js');
            const flaggedTrades = await TradeMongo.countDocuments({
                walletAddress: { $in: walletAddresses },
                'insiderScore.breakdown.total': { $gte: this.threshold },
                timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
            });
            return Math.min(3, flaggedTrades); // Cap at 3 to avoid over-weighting
        } catch (error) {
            console.error('[InsiderScorer] Error in countFlaggedConnections:', error);
            return 0;
        }
    }

    /**
     * Determine confidence level based on score
     */
    private getConfidenceLevel(score: number): ConfidenceLevel {
        if (score >= 80) return 'high';
        if (score >= this.threshold) return 'medium';
        return 'low';
    }

    /**
     * Get score explanation for display
     */
    getScoreExplanation(breakdown: ScoreBreakdown): string {
        const factors: string[] = [];

        if (breakdown.walletAge >= 15) {
            factors.push(`Fresh wallet (${breakdown.walletAge}/25)`);
        }
        if (breakdown.tradeSize >= 10) {
            factors.push(`Large trade size (${breakdown.tradeSize}/20)`);
        }
        if (breakdown.timing >= 20) {
            factors.push(`Suspicious timing (${breakdown.timing}/40)`);
        }
        if (breakdown.diversification >= 15) {
            factors.push(`High concentration (${breakdown.diversification}/30)`);
        }
        if (breakdown.onChainSource >= 10) {
            factors.push(`CEX funding detected (${breakdown.onChainSource}/15)`);
        }
        if (breakdown.impact >= 5) {
            factors.push(`Market impact (${breakdown.impact}/10)`);
        }
        if (breakdown.cluster >= 10) {
            factors.push(`Cluster detected (${breakdown.cluster}/30)`);
        }

        return factors.length > 0
            ? `Key factors: ${factors.join(', ')}`
            : 'No significant insider indicators';
    }
}
