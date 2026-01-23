/**
 * Trade Size & Impact Scoring Factors
 * - Trade Size: 20 pts max
 * - Impact: 10 pts max
 */
import { Trade } from '../../types/index.js';

/**
 * Factor 2: Trade Size (20 pts max)
 * Trades significantly larger than market average, or absolute size
 */
export function scoreTradeSize(trade: Trade): number {
    // If we have market average, use ratio-based scoring
    if (trade.marketAvgVolume > 0) {
        const ratio = trade.sizeUsd / trade.marketAvgVolume;

        if (ratio > 5) return 20;   // 5x+ market average
        if (ratio > 3) return 15;   // 3-5x market average
        if (ratio > 2) return 10;   // 2-3x market average
        if (ratio > 1.5) return 5;  // 1.5-2x market average
        return 0;
    }

    // Fallback: Use absolute trade size thresholds (whale trades are inherently notable)
    const sizeUsd = trade.sizeUsd;
    if (sizeUsd >= 100000) return 20;  // $100K+ is massive
    if (sizeUsd >= 50000) return 15;   // $50-100K is very large
    if (sizeUsd >= 25000) return 10;   // $25-50K is large
    if (sizeUsd >= 10000) return 5;    // $10-25K is notable
    return 0;
}

/**
 * Factor 7: Market Impact (10 pts max)
 * Combines:
 * - Post-trade probability shift
 * - LOW-LIQUIDITY WHALE: Single trade dominating thin market
 * - Trade volume dominance: One trade being a huge % of market volume
 */
export function scoreImpact(trade: Trade): number {
    let score = 0;

    // 1. Low-Liquidity Whale Detection (up to 5 pts)
    // If the trade is larger than the market's current liquidity, it's dominating
    if (trade.marketLiquidity && trade.marketLiquidity > 0) {
        const liquidityRatio = trade.sizeUsd / trade.marketLiquidity;

        if (liquidityRatio >= 0.5) {
            // Trade is 50%+ of market liquidity - EXTREME whale
            score += 5;
            console.log(`[TradeFactor] 🐋 LOW-LIQUIDITY WHALE: $${trade.sizeUsd.toLocaleString()} is ${(liquidityRatio * 100).toFixed(0)}% of market liquidity (+5 impact)`);
        } else if (liquidityRatio >= 0.25) {
            // Trade is 25-50% of liquidity - major whale
            score += 4;
            console.log(`[TradeFactor] 🐋 Thin market whale: $${trade.sizeUsd.toLocaleString()} is ${(liquidityRatio * 100).toFixed(0)}% of liquidity (+4 impact)`);
        } else if (liquidityRatio >= 0.1) {
            // Trade is 10-25% of liquidity - notable
            score += 2;
        }
    }

    // 2. Volume Dominance Detection (up to 3 pts)
    // If this single trade is a huge % of total market volume, it's suspicious
    if (trade.marketTotalVolume && trade.marketTotalVolume > 0) {
        const volumeRatio = trade.sizeUsd / trade.marketTotalVolume;

        if (volumeRatio >= 0.2) {
            // One trade = 20%+ of all volume ever on this market
            score += 3;
            console.log(`[TradeFactor] 📊 VOLUME DOMINANCE: $${trade.sizeUsd.toLocaleString()} is ${(volumeRatio * 100).toFixed(0)}% of total market volume (+3 impact)`);
        } else if (volumeRatio >= 0.1) {
            // 10-20% of total volume
            score += 2;
        } else if (volumeRatio >= 0.05) {
            // 5-10% of total volume
            score += 1;
        }
    }

    // 3. Price shift detection (up to 2 pts) - original logic, reduced weight
    const priceShift = Math.abs(trade.priceAfter - trade.priceBefore);
    if (priceShift > 0.1) {
        score += 2;    // >10% shift
    } else if (priceShift > 0.05) {
        score += 1;    // >5% shift
    }

    return Math.min(10, score); // Cap at 10
}
