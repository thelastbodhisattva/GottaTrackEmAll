/**
 * Diversification Scoring Factor (30 pts max)
 * Portfolio concentration and cross-market correlation
 */
import { Trade, WalletProfile } from '../../types/index.js';
import { PolymarketProfileClient } from '../../clients/polymarketProfile.js';

/**
 * Detect cross-market correlation patterns
 * Returns bonus (0-8 pts) for wallets focused on related markets
 */
export function detectCrossMarketCorrelation(marketsTraded: Array<{ title?: string; category?: string }>): number {
    const marketsWithTitles = marketsTraded.filter(m => m.title);
    if (marketsWithTitles.length < 2) return 0;

    const allTitles = marketsWithTitles.map(m => m.title!.toLowerCase());

    const correlationPatterns: { keywords: string[]; name: string }[] = [
        { keywords: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'token', 'halving'], name: 'crypto' },
        { keywords: ['trump', 'biden', 'election', 'president', 'republican', 'democrat'], name: 'us-politics' },
        { keywords: ['ukraine', 'russia', 'putin', 'zelensky', 'nato', 'war'], name: 'ukraine-conflict' },
        { keywords: ['israel', 'gaza', 'hamas', 'netanyahu', 'ceasefire'], name: 'israel-gaza' },
        { keywords: ['fed', 'interest rate', 'inflation', 'cpi', 'fomc'], name: 'fed-rates' },
        { keywords: ['spacex', 'starship', 'launch', 'rocket', 'nasa'], name: 'space' },
        { keywords: ['ai', 'openai', 'gpt', 'anthropic', 'google', 'gemini'], name: 'ai' },
    ];

    for (const pattern of correlationPatterns) {
        let matchCount = 0;
        for (const title of allTitles) {
            if (pattern.keywords.some(kw => title.includes(kw))) {
                matchCount++;
            }
        }

        const matchRatio = matchCount / marketsWithTitles.length;
        if (matchRatio >= 0.7 && matchCount >= 2) {
            const bonus = Math.min(8, Math.floor(matchRatio * 10));
            console.log(`[DiversificationFactor] 🔄 Cross-market correlation: ${matchCount}/${marketsWithTitles.length} markets in '${pattern.name}' cluster (+${bonus})`);
            return bonus;
        }
    }

    const datePatterns = ['by january', 'by february', 'by march', 'before', 'after', '2024', '2025', '2026'];
    for (const datePattern of datePatterns) {
        const dateMatches = allTitles.filter(t => t.includes(datePattern)).length;
        if (dateMatches >= 2 && dateMatches / marketsWithTitles.length >= 0.7) {
            console.log(`[DiversificationFactor] 📅 Date-specific clustering: ${dateMatches}/${marketsWithTitles.length} markets with '${datePattern}' (+5)`);
            return 5;
        }
    }

    return 0;
}

/**
 * Factor 4: Diversification (30 pts max)
 * High portfolio concentration = high conviction
 */
export async function scoreDiversification(
    wallet: string,
    profile: WalletProfile | null,
    polymarketProfile: PolymarketProfileClient,
    trade?: Trade
): Promise<number> {
    try {
        if (!profile || !profile.marketsTraded || profile.marketsTraded.length === 0) {
            return 15; // No trading history = single market focus (max score)
        }

        const uniqueMarkets = profile.marketsTraded.length;

        let baseScore = 0;
        if (uniqueMarkets === 1) baseScore = 15;
        else if (uniqueMarkets <= 3) baseScore = 12;
        else if (uniqueMarkets <= 5) baseScore = 8;
        else if (uniqueMarkets <= 10) baseScore = 4;
        else baseScore = 0;

        // Category concentration bonus (+3 pts)
        const categories = profile.marketsTraded.map(m => m.category).filter(c => c);
        const uniqueCategories = new Set(categories).size;

        if (uniqueMarkets <= 5 && uniqueCategories === 1 && categories.length > 0) {
            baseScore += 3;
            console.log(`[DiversificationFactor] Category focus: all ${uniqueMarkets} markets in ${categories[0]} (+3)`);
        }

        // Cross-market correlation bonus (+8 pts max)
        if (uniqueMarkets >= 2 && uniqueMarkets <= 8) {
            const correlationBonus = detectCrossMarketCorrelation(profile.marketsTraded);
            if (correlationBonus > 0) {
                baseScore += correlationBonus;
            }
        }

        // Noise trade penalty
        const activity = await polymarketProfile.getWalletActivity(wallet, 50);

        if (activity) {
            if (activity.noiseTradeRatio > 0.2) {
                baseScore = Math.max(0, baseScore - 3);
                console.log(`[DiversificationFactor] Noise trade detected: ${(activity.noiseTradeRatio * 100).toFixed(0)}% tiny/near-certain bets (-3pts)`);
            }

            if (activity.hasWashTrading) {
                baseScore = Math.max(0, baseScore - 2);
                console.log(`[DiversificationFactor] Wash trading detected (-2pts)`);
            }

            // Masking pattern detection (+5 pts)
            if (trade && activity.noiseTradeRatio > 0.1 && trade.sizeUsd > 25000) {
                baseScore += 5;
                console.log(`[DiversificationFactor] 🎭 Masking pattern: noise trades + $${trade.sizeUsd.toLocaleString()} main bet (+5)`);
            }

            // Volume concentration check (+4 pts)
            if (activity.maxSingleTradeRatio > 0.85 && activity.noiseTradeRatio > 0.05 && activity.trades.length >= 3) {
                baseScore += 4;
                console.log(`[DiversificationFactor] 🎯 Volume concentration detected (+4)`);
            }
        }

        const finalScore = Math.max(0, Math.min(30, baseScore));
        if (finalScore >= 10) {
            console.log(`[DiversificationFactor] High concentration: ${uniqueMarkets} markets (score=${finalScore}/30)`);
        }

        return finalScore;
    } catch (error) {
        console.error('[DiversificationFactor] Error:', error);
        return 0;
    }
}
