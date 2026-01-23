import { Trade, Wallet, isMongoDBConnected } from '../db/index.js';

/**
 * ClusterDetector - Basic cluster detection using shared funding sources and 
 * coordinated trading patterns (no extensive Alchemy calls to save rate limits)
 * 
 * Detection methods:
 * 1. Shared funding source (same CEX/bridge address)
 * 2. Synchronized trading (same market, same side, close timestamp)
 */
export class ClusterDetector {
    // In-memory cache of funding sources to avoid repeated lookups
    private fundingCache = new Map<string, string | null>();

    /**
     * Analyze cluster connections for a wallet
     * Returns cluster score contribution for insider detection (0-5 pts)
     */
    async analyzeCluster(walletAddress: string): Promise<{
        clusterScore: number;
        connectedWallets: string[];
        sharedFunding: string | null;
        synchronizedTrades: number;
        details: string;
    }> {
        if (!isMongoDBConnected()) {
            return {
                clusterScore: 0,
                connectedWallets: [],
                sharedFunding: null,
                synchronizedTrades: 0,
                details: 'MongoDB not connected',
            };
        }

        try {
            let clusterScore = 0;
            const details: string[] = [];
            const connectedWallets: string[] = [];

            // 1. Check for shared funding source
            const wallet = await Wallet.findOne({ address: walletAddress });
            const fundingSource = wallet?.fundingSource || null;

            if (fundingSource) {
                // Find other wallets with same funding
                const connectedByFunding = await Wallet.find({
                    address: { $ne: walletAddress },
                    fundingSource,
                }).select('address');

                if (connectedByFunding.length > 0) {
                    connectedWallets.push(...connectedByFunding.map(w => w.address));
                    clusterScore += Math.min(3, connectedByFunding.length); // Up to 3 pts
                    details.push(`Shared funding (${fundingSource?.slice(0, 10) || 'unknown'}...): ${connectedByFunding.length} wallets`);
                }
            }

            // 2. Check for synchronized trading patterns
            const synchronizedTrades = await this.findSynchronizedTrades(walletAddress);

            if (synchronizedTrades.count >= 3) {
                clusterScore += 2;
                connectedWallets.push(...synchronizedTrades.wallets.filter(w => !connectedWallets.includes(w)));
                details.push(`Synchronized trades: ${synchronizedTrades.count} with ${synchronizedTrades.wallets.length} wallets`);
            } else if (synchronizedTrades.count >= 1) {
                clusterScore += 1;
                details.push(`Some synchronized activity: ${synchronizedTrades.count} trades`);
            }

            // Update wallet with cluster data
            if (connectedWallets.length > 0) {
                await Wallet.updateOne(
                    { address: walletAddress },
                    {
                        $set: {
                            connectedWallets,
                            clusterScore,
                        },
                    }
                );
            }

            return {
                clusterScore: Math.min(5, clusterScore), // Cap at 5 pts
                connectedWallets,
                sharedFunding: fundingSource,
                synchronizedTrades: synchronizedTrades.count,
                details: details.join('; ') || 'No cluster detected',
            };
        } catch (error) {
            console.error('[ClusterDetector] Failed to analyze cluster:', error);
            return {
                clusterScore: 0,
                connectedWallets: [],
                sharedFunding: null,
                synchronizedTrades: 0,
                details: 'Error analyzing cluster',
            };
        }
    }

    /**
     * Find trades synchronized with other wallets
     * (same market, same side, within 30 minutes)
     */
    private async findSynchronizedTrades(
        walletAddress: string
    ): Promise<{ count: number; wallets: string[] }> {
        try {
            // Get this wallet's recent trades
            const walletTrades = await Trade.find({ walletAddress })
                .sort({ timestamp: -1 })
                .limit(20);

            if (walletTrades.length === 0) {
                return { count: 0, wallets: [] };
            }

            const synchronizedWallets = new Set<string>();
            let syncCount = 0;

            for (const trade of walletTrades) {
                // Find other wallets trading same market/side within 30 min window
                const windowStart = new Date(trade.timestamp.getTime() - 30 * 60 * 1000);
                const windowEnd = new Date(trade.timestamp.getTime() + 30 * 60 * 1000);

                const synchronizedTrades = await Trade.find({
                    walletAddress: { $ne: walletAddress },
                    marketId: trade.marketId,
                    side: trade.side,
                    timestamp: { $gte: windowStart, $lte: windowEnd },
                }).select('walletAddress');

                for (const syncTrade of synchronizedTrades) {
                    synchronizedWallets.add(syncTrade.walletAddress);
                    syncCount++;
                }
            }

            return {
                count: syncCount,
                wallets: Array.from(synchronizedWallets),
            };
        } catch (error) {
            console.error('[ClusterDetector] Failed to find synchronized trades:', error);
            return { count: 0, wallets: [] };
        }
    }

    /**
     * Set funding source for a wallet (called when CEX deposit detected)
     */
    async setFundingSource(walletAddress: string, source: string): Promise<void> {
        if (!isMongoDBConnected()) return;

        try {
            await Wallet.updateOne(
                { address: walletAddress },
                { $set: { fundingSource: source } }
            );
            this.fundingCache.set(walletAddress, source);
        } catch (error) {
            console.error('[ClusterDetector] Failed to set funding source:', error);
        }
    }

    /**
     * Get wallets in the same cluster
     */
    async getClusterMembers(walletAddress: string): Promise<string[]> {
        if (!isMongoDBConnected()) return [];

        try {
            const wallet = await Wallet.findOne({ address: walletAddress });
            return wallet?.connectedWallets || [];
        } catch {
            return [];
        }
    }

    /**
     * Check if two wallets are in the same cluster
     */
    async areWalletsConnected(walletA: string, walletB: string): Promise<boolean> {
        if (!isMongoDBConnected()) return false;

        try {
            const wallet = await Wallet.findOne({ address: walletA });
            return wallet?.connectedWallets?.includes(walletB) || false;
        } catch {
            return false;
        }
    }

    /**
     * Detect fresh wallet cluster on a specific market
     * Returns cluster info if 3+ fresh wallets are betting same side
     * 
     * INSIDER SIGNAL: Coordinated info leak - multiple fresh wallets
     * betting same direction within short timeframe
     */
    async detectFreshWalletCluster(
        marketId: string,
        side: 'YES' | 'NO',
        _currentWallet: string
    ): Promise<{
        isCluster: boolean;
        clusterSize: number;
        freshWallets: string[];
        totalClusterVolume: number;
        clusterScore: number;
    }> {
        if (!isMongoDBConnected()) {
            return { isCluster: false, clusterSize: 0, freshWallets: [], totalClusterVolume: 0, clusterScore: 0 };
        }

        try {
            // Find trades on this market/side in last 24 hours
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

            const recentTrades = await Trade.find({
                marketId,
                side,
                timestamp: { $gte: since },
            }).select('walletAddress sizeUsd');

            // Collect unique wallets
            const walletVolumes = new Map<string, number>();
            for (const trade of recentTrades) {
                const current = walletVolumes.get(trade.walletAddress) || 0;
                walletVolumes.set(trade.walletAddress, current + trade.sizeUsd);
            }

            // Check which wallets are "fresh" (< 7 days old, < 10 trades)
            // Batch query to avoid N+1 problem
            const walletAddresses = [...walletVolumes.keys()];
            const wallets = await Wallet.find({ address: { $in: walletAddresses } });
            const walletMap = new Map(wallets.map(w => [w.address, w]));

            const freshWallets: string[] = [];
            let totalClusterVolume = 0;

            for (const [walletAddr, volume] of walletVolumes) {
                const wallet = walletMap.get(walletAddr);

                if (wallet) {
                    const ageDays = wallet.firstSeen
                        ? (Date.now() - wallet.firstSeen.getTime()) / (1000 * 60 * 60 * 24)
                        : 999;

                    const isFresh = ageDays < 7 && wallet.totalTrades < 10;

                    if (isFresh) {
                        freshWallets.push(walletAddr);
                        totalClusterVolume += volume;
                    }
                }
            }

            // Cluster threshold: 3+ fresh wallets
            const isCluster = freshWallets.length >= 3;

            // Base score: 5 for 3 wallets, +3 for each additional, max 15
            let clusterScore = 0;
            if (isCluster) {
                clusterScore = Math.min(15, 5 + (freshWallets.length - 3) * 3);
                console.log(`[ClusterDetector] 🚨 FRESH WALLET CLUSTER: ${freshWallets.length} wallets betting ${side} on ${marketId.slice(0, 10)}... (+${clusterScore} pts)`);

                // ENHANCED: Split bets detection bonus (+15 pts max)
                // Now with liquidity-aware thresholds and tiered wallet bonuses
                let splitBetsBonus = 0;

                // Volume-based bonus (up to 10 pts)
                // $20K base, or 25% of market liquidity for smaller markets
                const volumeThreshold = 20000; // Can be made dynamic with market data
                if (totalClusterVolume >= volumeThreshold) {
                    // Tiered: +5 at threshold, +2 per additional $20K, max +10
                    splitBetsBonus += Math.min(10, 5 + Math.floor((totalClusterVolume - volumeThreshold) / 20000) * 2);
                }

                // Wallet count bonus (up to 5 pts more)
                // Reward detection of larger coordinated rings
                if (freshWallets.length >= 5) {
                    splitBetsBonus += Math.min(5, (freshWallets.length - 4)); // +1 per wallet beyond 4, max +5
                }

                if (splitBetsBonus > 0) {
                    console.log(`[ClusterDetector] 💰 Split bets detected: $${totalClusterVolume.toLocaleString()} across ${freshWallets.length} fresh wallets (+${splitBetsBonus} pts bonus)`);
                }

                clusterScore = Math.min(30, clusterScore + splitBetsBonus);
            }

            return {
                isCluster,
                clusterSize: freshWallets.length,
                freshWallets,
                totalClusterVolume,
                clusterScore,
            };
        } catch (error) {
            console.error('[ClusterDetector] Failed to detect fresh wallet cluster:', error);
            return { isCluster: false, clusterSize: 0, freshWallets: [], totalClusterVolume: 0, clusterScore: 0 };
        }
    }
}
