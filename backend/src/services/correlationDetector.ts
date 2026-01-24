import { Trade, isMongoDBConnected } from '../db/index.js';
import { MarketService } from './marketService.js';

/**
 * Signal indicating correlated positions detected across related markets
 */
export interface CorrelationSignal {
    relatedMarketId: string;
    relatedMarketQuestion: string;
    walletSide: 'YES' | 'NO';
    currentSide: 'YES' | 'NO';
    logicallyConsistent: boolean;  // true = both positions make logical sense together
    correlationStrength: number;   // 0-1 based on semantic similarity
}

/**
 * Related market pair for correlation tracking
 */
interface RelatedMarketPair {
    marketId1: string;
    marketId2: string;
    question1: string;
    question2: string;
    relationship: 'mutually_exclusive' | 'complementary' | 'related';
    strength: number;  // 0-1
}

/**
 * CorrelationDetector - Detects wallets betting on logically related markets
 * 
 * Key patterns detected:
 * - Mutual exclusion: YES on "Trump wins" + NO on "Biden wins" 
 * - Complementary: YES on "BTC hits $100k" + YES on "Crypto bull market"
 * - Hedging: Positions on both sides of related outcomes
 */
export class CorrelationDetector {
    private marketService: MarketService;

    // Cache of related market pairs (refreshed periodically)
    private relatedMarkets: Map<string, RelatedMarketPair[]> = new Map();
    private lastCacheRefresh: number = 0;
    private readonly cacheLifetimeMs = 30 * 60 * 1000; // 30 minutes

    // Keywords for detecting related markets
    private readonly electionKeywords = [
        'wins', 'elected', 'president', 'senate', 'house', 'governor',
        'trump', 'biden', 'harris', 'vance', 'republican', 'democrat',
    ];

    private readonly cryptoKeywords = [
        'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'price',
        'above', 'below', 'hit', 'reach', 'bull', 'bear', 'crypto',
    ];

    private readonly sportsKeywords = [
        'win', 'beat', 'champion', 'final', 'super bowl', 'world series',
        'playoffs', 'score', 'over', 'under',
    ];

    constructor(marketService: MarketService) {
        this.marketService = marketService;
    }

    /**
     * Find markets semantically related to a given market
     */
    async findRelatedMarkets(marketId: string): Promise<string[]> {
        await this.refreshCacheIfNeeded();

        const pairs = this.relatedMarkets.get(marketId) || [];
        return pairs.map(p => p.marketId1 === marketId ? p.marketId2 : p.marketId1);
    }

    /**
     * Check if a wallet has positions on related markets
     * Returns correlation signal if found
     */
    async checkCorrelatedPositions(
        walletAddress: string,
        currentMarketId: string,
        currentSide: 'YES' | 'NO'
    ): Promise<CorrelationSignal | null> {
        if (!isMongoDBConnected()) {
            return null;
        }

        try {
            // Get current market details
            const currentMarket = await this.marketService.getMarket(currentMarketId);
            if (!currentMarket) {
                return null;
            }

            // Find related markets
            const relatedMarketIds = await this.findRelatedMarkets(currentMarketId);
            if (relatedMarketIds.length === 0) {
                // Try to build relationships on-the-fly based on title
                await this.buildRelationshipsForMarket(currentMarketId, currentMarket.title);
            }

            // Check wallet's positions in related markets
            const walletTrades = await Trade.find({
                walletAddress: walletAddress.toLowerCase(),
                marketId: { $in: relatedMarketIds },
            }).sort({ timestamp: -1 }).limit(10);

            if (walletTrades.length === 0) {
                return null;
            }

            // Analyze the first related position found
            const relatedTrade = walletTrades[0];
            const relatedMarket = await this.marketService.getMarket(relatedTrade.marketId);

            if (!relatedMarket) {
                return null;
            }

            // Calculate semantic similarity
            const similarity = this.calculateSimilarity(
                currentMarket.title,
                relatedMarket.title
            );

            // Determine if positions are logically consistent
            const logicallyConsistent = this.checkLogicalConsistency(
                currentMarket.title,
                currentSide,
                relatedMarket.title,
                relatedTrade.side as 'YES' | 'NO'
            );

            return {
                relatedMarketId: relatedTrade.marketId,
                relatedMarketQuestion: relatedMarket.title,
                walletSide: relatedTrade.side as 'YES' | 'NO',
                currentSide,
                logicallyConsistent,
                correlationStrength: similarity,
            };
        } catch (error) {
            console.error('[CorrelationDetector] Error checking correlations:', error);
            return null;
        }
    }

    /**
     * Calculate semantic similarity between two market questions
     * Uses keyword overlap and pattern matching
     */
    private calculateSimilarity(question1: string, question2: string): number {
        const q1 = question1.toLowerCase();
        const q2 = question2.toLowerCase();

        // Extract keywords
        const keywords1 = new Set(q1.split(/\s+/).filter(w => w.length > 3));
        const keywords2 = new Set(q2.split(/\s+/).filter(w => w.length > 3));

        // Calculate Jaccard similarity
        const intersection = new Set([...keywords1].filter(x => keywords2.has(x)));
        const union = new Set([...keywords1, ...keywords2]);

        if (union.size === 0) return 0;

        const jaccardSimilarity = intersection.size / union.size;

        // Boost for matching category keywords
        let categoryBoost = 0;

        const hasElection1 = this.electionKeywords.some(k => q1.includes(k));
        const hasElection2 = this.electionKeywords.some(k => q2.includes(k));
        if (hasElection1 && hasElection2) categoryBoost = 0.2;

        const hasCrypto1 = this.cryptoKeywords.some(k => q1.includes(k));
        const hasCrypto2 = this.cryptoKeywords.some(k => q2.includes(k));
        if (hasCrypto1 && hasCrypto2) categoryBoost = 0.2;

        const hasSports1 = this.sportsKeywords.some(k => q1.includes(k));
        const hasSports2 = this.sportsKeywords.some(k => q2.includes(k));
        if (hasSports1 && hasSports2) categoryBoost = 0.2;

        return Math.min(1, jaccardSimilarity + categoryBoost);
    }

    /**
     * Check if two positions make logical sense together
     */
    private checkLogicalConsistency(
        question1: string,
        side1: 'YES' | 'NO',
        question2: string,
        side2: 'YES' | 'NO'
    ): boolean {
        const q1 = question1.toLowerCase();
        const q2 = question2.toLowerCase();

        // Check for mutually exclusive outcomes (e.g., different candidates winning same election)
        const candidates = ['trump', 'biden', 'harris', 'vance', 'desantis'];
        const candidate1 = candidates.find(c => q1.includes(c));
        const candidate2 = candidates.find(c => q2.includes(c));

        if (candidate1 && candidate2 && candidate1 !== candidate2) {
            // Different candidates in same race - YES on one should imply NO on other
            if (q1.includes('wins') && q2.includes('wins')) {
                return (side1 === 'YES' && side2 === 'NO') || (side1 === 'NO' && side2 === 'YES');
            }
        }

        // Check for complementary outcomes (same candidate, different aspects)
        if (candidate1 && candidate1 === candidate2) {
            // Same candidate - positions should typically align
            return side1 === side2;
        }

        // Check for crypto price levels
        if (q1.includes('btc') && q2.includes('btc')) {
            // Betting UP on higher price level implies UP on lower price level
            const price1 = this.extractPriceLevel(q1);
            const price2 = this.extractPriceLevel(q2);

            if (price1 && price2 && price1 !== price2) {
                // Higher price requires lower price to be true
                if (price1 > price2) {
                    // If betting YES on higher, should also bet YES on lower
                    return side1 === 'YES' ? side2 === 'YES' : true;
                }
            }
        }

        // Default: assume consistent if we can't determine relationship
        return true;
    }

    /**
     * Extract price level from a market question
     */
    private extractPriceLevel(question: string): number | null {
        const matches = question.match(/\$?([\d,]+)k?/i);
        if (!matches) return null;

        let value = parseInt(matches[1].replace(/,/g, ''));
        if (question.toLowerCase().includes('k')) {
            value *= 1000;
        }
        return value;
    }

    /**
     * Build market relationships on-the-fly for a market
     */
    private async buildRelationshipsForMarket(marketId: string, title: string): Promise<void> {
        // Get recent markets and compare
        try {
            const recentMarkets = await this.marketService.getActiveMarkets();
            const relationships: RelatedMarketPair[] = [];

            // Only process first 100 markets to avoid performance issues
            const marketsToCheck = recentMarkets.slice(0, 100);

            for (const market of marketsToCheck) {
                if (market.id === marketId) continue;

                const similarity = this.calculateSimilarity(title, market.title);
                if (similarity >= 0.3) {
                    relationships.push({
                        marketId1: marketId,
                        marketId2: market.id,
                        question1: title,
                        question2: market.title,
                        relationship: similarity >= 0.7 ? 'mutually_exclusive' : 'related',
                        strength: similarity,
                    });
                }
            }

            // Store relationships
            const existing = this.relatedMarkets.get(marketId) || [];
            this.relatedMarkets.set(marketId, [...existing, ...relationships]);
        } catch (error) {
            console.error('[CorrelationDetector] Error building relationships:', error);
        }
    }

    /**
     * Refresh the related markets cache if stale
     */
    private async refreshCacheIfNeeded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastCacheRefresh < this.cacheLifetimeMs) {
            return;
        }

        this.lastCacheRefresh = now;
        // For efficiency, we build relationships on-demand rather than pre-computing
        // Clear old entries to prevent memory bloat
        if (this.relatedMarkets.size > 1000) {
            this.relatedMarkets.clear();
        }
    }

    /**
     * Get correlation stats for admin/debugging
     */
    getStats(): { cacheSize: number; lastRefresh: Date } {
        return {
            cacheSize: this.relatedMarkets.size,
            lastRefresh: new Date(this.lastCacheRefresh),
        };
    }
}
