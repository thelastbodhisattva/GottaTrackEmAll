/**
 * On-Chain Source Scoring Factor (15 pts max)
 * CEX deposits, bridge transfers, funding patterns
 */
import { Trade } from '../../types/index.js';
import { PolygonRpcClient } from '../../clients/polygonRpc.js';
import { ArkhamClient } from '../../clients/arkham.js';

/**
 * Factor 5: On-Chain Source (15 pts max)
 * CEX deposits, fresh funding, bridge transfers, dormant reactivation
 */
export async function scoreOnChainSource(
    trade: Trade,
    firstTxTime: number | null,
    polygonRpc: PolygonRpcClient,
    arkham?: ArkhamClient
): Promise<number> {
    let score = 0;

    try {
        // Use Alchemy to detect funding source (CEX, bridge, contract)
        const fundingSource = await polygonRpc.detectFundingSource(trade.walletAddress);

        if (fundingSource) {
            if (fundingSource.type === 'exchange') {
                score += 10;
                console.log(`[OnChainFactor] CEX funding: ${fundingSource.label} (+10)`);
            }

            if (fundingSource.type === 'bridge') {
                score += 7;
                console.log(`[OnChainFactor] Bridge funding: ${fundingSource.label} (+7)`);
            }

            if (fundingSource.type === 'contract') {
                score += 5;
                console.log(`[OnChainFactor] Contract funding detected (+5)`);
            }
        }

        // Fresh wallet making large trade (5 pts)
        if (firstTxTime) {
            const walletAgeDays = (Date.now() - firstTxTime) / (1000 * 60 * 60 * 24);
            if (walletAgeDays < 3 && trade.sizeUsd > 10000) {
                score += 5;
                console.log(`[OnChainFactor] Fresh wallet (<3 days) making large trade ($${trade.sizeUsd.toFixed(0)}) (+5)`);
            }
        }

        // Arkham entity tagging (if available)
        if (arkham?.isEnabled()) {
            const entity = await arkham.getEntity(trade.walletAddress);
            if (entity?.isTagged) {
                score -= 5;
                console.log(`[OnChainFactor] Arkham tagged entity (-5)`);
            }
        }
    } catch (error) {
        console.error('[OnChainFactor] Error:', error);
    }

    const finalScore = Math.max(0, Math.min(15, score));
    if (finalScore > 0) {
        console.log(`[OnChainFactor] Score: ${finalScore}/15`);
    }
    return finalScore;
}
