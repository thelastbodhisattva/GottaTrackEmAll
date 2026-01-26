import { config } from '../config/index.js';
import {
    RawTrade,
    Trade,
    EnrichedTrade,
    TradeSide,
    WalletProfile,
} from '../types/index.js';
import { InsiderScorer } from './insiderScorer.js';
import { WalletProfiler } from './walletProfiler.js';
import { MarketService } from './marketService.js';
import { OrderFlowTracker } from './orderFlowTracker.js';
import { PolygonRpcClient, deriveProxyAddress } from '../clients/polygonRpc.js';
import { tradeCounter, flaggedTradeCounter } from '../middleware/metrics.js';
import { recordTradeForVelocity } from '../cache/redis.js';

/**
 * Trade processor that filters, enriches, and scores whale trades
 */
export class TradeProcessor {
    private readonly whaleThreshold: number;

    // Replay protection: track recently processed trade IDs
    private processedTradeIds = new Map<string, number>(); // tradeId -> timestamp
    // Content-based deduplication: same trade can have different IDs
    private processedTradeHashes = new Map<string, number>(); // contentHash -> timestamp
    private readonly replayWindowMs = 60 * 60 * 1000; // 1 hour window
    private readonly contentDedupWindowMs = 5 * 60 * 1000; // 5 minute window for content dedup
    private replayCleanupInterval: ReturnType<typeof setInterval>;

    constructor(
        private scorer: InsiderScorer,
        private profiler: WalletProfiler,
        private marketService: MarketService,
        private orderFlowTracker: OrderFlowTracker,
        private polygonRpc?: PolygonRpcClient  // Optional for wallet resolution
    ) {
        this.whaleThreshold = config.whaleThresholdUsd;

        // Clean up old trade IDs every 15 minutes
        this.replayCleanupInterval = setInterval(() => {
            this.cleanupProcessedTrades();
        }, 15 * 60 * 1000);
    }

    /**
     * Clean up old processed trade IDs to prevent memory leak
     */
    private cleanupProcessedTrades(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [tradeId, timestamp] of this.processedTradeIds) {
            if (now - timestamp > this.replayWindowMs) {
                this.processedTradeIds.delete(tradeId);
                cleaned++;
            }
        }

        // Also clean up content hashes
        let hashCleaned = 0;
        for (const [hash, timestamp] of this.processedTradeHashes) {
            if (now - timestamp > this.contentDedupWindowMs) {
                this.processedTradeHashes.delete(hash);
                hashCleaned++;
            }
        }

        if (cleaned > 0 || hashCleaned > 0) {
            console.log(`[TradeProcessor] Cleaned up ${cleaned} trade IDs, ${hashCleaned} content hashes`);
        }
    }

    /**
     * Atomically check if a trade has been processed and mark it if not.
     * Returns true if this is a NEW trade (not seen before), false if duplicate.
     * This prevents race conditions where two concurrent calls could both pass the check.
     */
    private tryMarkAsProcessed(tradeId: string): boolean {
        // Atomic check-and-set: if already present, return false (duplicate)
        if (this.processedTradeIds.has(tradeId)) {
            return false;
        }
        // Mark as processed atomically
        this.processedTradeIds.set(tradeId, Date.now());
        return true;
    }

    /**
     * Stop the cleanup interval (for graceful shutdown)
     */
    shutdown(): void {
        if (this.replayCleanupInterval) {
            clearInterval(this.replayCleanupInterval);
        }
    }

    /**
     * Create a content hash for deduplication
     * Same trade can arrive with different IDs but same content
     */
    private createContentHash(raw: RawTrade): string {
        // Round size to 2 decimals to handle minor floating point differences
        const sizeRounded = Math.round(parseFloat(raw.size) * 100);
        const priceRounded = Math.round(parseFloat(raw.price) * 10000);
        return `${raw.asset_id}_${sizeRounded}_${priceRounded}_${raw.side}`;
    }

    /**
     * Check if content hash is a duplicate, return true if NEW (not duplicate)
     */
    private tryMarkContentHash(hash: string): boolean {
        if (this.processedTradeHashes.has(hash)) {
            return false; // Duplicate content
        }
        this.processedTradeHashes.set(hash, Date.now());
        return true;
    }

    /**
     * Process a raw trade from WebSocket
     * Returns enriched trade if it meets whale threshold, null otherwise
     */
    async process(rawTrade: RawTrade): Promise<EnrichedTrade | null> {
        // FIRST: Content-based deduplication (catches same trade with different IDs)
        const contentHash = this.createContentHash(rawTrade);
        if (!this.tryMarkContentHash(contentHash)) {
            // Silent skip for content duplicates (very common)
            return null;
        }

        // Parse raw trade
        const trade = this.parseRawTrade(rawTrade);
        if (!trade) {
            return null;
        }

        // Atomic replay protection: skip if already processed by ID
        // This combines check + set into one operation to prevent race conditions
        if (!this.tryMarkAsProcessed(trade.id)) {
            return null;
        }

        // Filter non-whale trades (silent unless it's a whale)
        if (trade.sizeUsd < this.whaleThreshold) {
            return null;
        }

        console.log(`[TradeProcessor] 🐋 WHALE TRADE DETECTED: $${trade.sizeUsd.toLocaleString()}`);

        try {
            // Enrich with market data
            const enrichedTrade = await this.enrichTrade(trade);
            return enrichedTrade;
        } catch (error) {
            console.error(`[TradeProcessor] Error processing trade ${trade.id}:`, error);
            return null;
        }
    }

    /**
     * Parse raw WebSocket trade into structured Trade object
     */
    private parseRawTrade(raw: RawTrade): Trade | null {
        try {
            const price = parseFloat(raw.price);
            const size = parseFloat(raw.size);

            // Validate parsed numbers - reject if NaN or invalid
            if (isNaN(price) || isNaN(size) || price <= 0 || size <= 0) {
                return null; // Invalid trade data
            }

            // Calculate USD size (assuming USDC backing)
            const sizeUsd = size * price;

            // Determine side from raw side field
            const side: TradeSide = raw.side?.toUpperCase() === 'YES' ? 'YES' : 'NO';

            // Use maker_address as the wallet address, fall back to taker_address
            const walletAddress = raw.maker_address || raw.taker_address || '';

            // Validate timestamp - fall back to current time if invalid
            let timestamp: Date;
            if (raw.timestamp) {
                const parsed = new Date(raw.timestamp);
                // Check if date is valid (not NaN)
                timestamp = isNaN(parsed.getTime()) ? new Date() : parsed;
            } else {
                timestamp = new Date();
            }

            return {
                id: raw.id || `${raw.asset_id}_${raw.timestamp}_${raw.price}`,
                marketId: raw.asset_id,
                walletAddress: walletAddress,
                marketTitle: 'Unknown Market', // Will be enriched later
                marketCategory: 'other', // Will be enriched later
                side,
                price,
                priceBefore: price,
                priceAfter: price,
                sizeUsd,
                shares: size,
                timestamp,
                marketAvgVolume: 0, // Will be enriched later
                transactionHash: raw.transaction_hash || '',
            };
        } catch (error) {
            console.error('[TradeProcessor] Error parsing raw trade:', error);
            return null;
        }
    }

    /**
     * Enrich trade with market data, wallet profile, and insider score
     */
    private async enrichTrade(trade: Trade): Promise<EnrichedTrade> {
        // Record this trade for velocity tracking (used by insider scorer)
        if (trade.walletAddress) {
            await recordTradeForVelocity(trade.walletAddress);
        }

        // STEP 1: Resolve wallet address if missing
        if (!trade.walletAddress && this.polygonRpc) {
            console.log(`[TradeProcessor] Wallet address missing for trade ${trade.id}, fetching...`);

            // STRATEGY: ON-CHAIN FIRST (Real-time truth)
            // Data API is lagging by ~3 hours, so we MUST check blockchain first.

            console.log(`[TradeProcessor] 🔗 Searching on-chain for trade...`);
            // Scan last 50 blocks (~2 mins)
            const onChainResult = await this.polygonRpc.findRecentTradeWithProxy(trade.marketId, trade.shares, 50);

            if (onChainResult) {
                console.log(`[TradeProcessor] ✅ Got REAL EOA from On-Chain: ${onChainResult.eoa.slice(0, 12)}..., Proxy: ${onChainResult.proxyAddress.slice(0, 12)}...`);
                trade.walletAddress = onChainResult.eoa;

                if (!trade.proxyWalletAddress) {
                    trade.proxyWalletAddress = onChainResult.proxyAddress;
                    console.log(`[TradeProcessor] 📦 Using on-chain proxy: ${trade.proxyWalletAddress.slice(0, 12)}...`);
                }
            } else {
                console.log(`[TradeProcessor] ⚠️ On-Chain search failed. Trying Data API fallback (Warning: Likely lagging)...`);

                // FALLBACK: Data API (Likely stale, but better than nothing?)
                // ... [Existing Data API logic mostly as backup, or maybe skip it to avoid false positives?]
                // Let's keep it but with strict checks

                // Try to get txHash from Data API if we don't have it
                let txHash = trade.transactionHash;
                let proxyWallet: string | null = null;

                if (!txHash) {
                    // WAIT for API indexing: Data API lags behind WebSocket by 2-5 seconds (or hours...)
                    console.log(`[TradeProcessor] ⏳ Waiting 3s for Data API indexing...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    const ourUsdValue = trade.shares * trade.price;

                    // FIRST: Try to get market info to get conditionId for better matching
                    let conditionId: string | undefined;
                    try {
                        const market = await this.marketService.getMarket(trade.marketId);
                        if (market?.conditionId) {
                            conditionId = market.conditionId;
                            console.log(`[TradeProcessor] Got market conditionId: ${conditionId.slice(0, 20)}...`);
                        }
                    } catch (err) {
                        // Market lookup failed, proceed without conditionId
                    }

                    console.log(`[TradeProcessor] Looking for fallback trade: asset=${trade.marketId.slice(0, 20)}..., shares=${trade.shares.toFixed(0)}, USD=$${ourUsdValue.toFixed(0)}`);

                    // Match by conditionId (best) or asset (fallback)
                    const matchedTrade = await this.marketService.getTradeByAsset(
                        trade.marketId,
                        trade.shares,
                        trade.price,
                        conditionId  // Pass conditionId for accurate matching
                    );

                    if (matchedTrade) {
                        txHash = matchedTrade.transactionHash;
                        proxyWallet = matchedTrade.proxyWallet;
                        console.log(`[TradeProcessor] ✅ Found Data API trade (Fallback)! Proxy: ${proxyWallet?.slice(0, 12)}..., TxHash: ${txHash?.slice(0, 12)}...`);
                    } else {
                        console.log(`[TradeProcessor] ⚠️ No matching trade found by asset via Data API`);
                    }

                    if (proxyWallet && !trade.proxyWalletAddress) {
                        trade.proxyWalletAddress = proxyWallet;
                    }

                    if (txHash) {
                        trade.transactionHash = txHash;
                        // Use Alchemy to get real EOA from transaction
                        const eoa = await this.polygonRpc.getEoaFromTx(txHash);
                        if (eoa) {
                            console.log(`[TradeProcessor] ✅ Got EOA from Data API match: ${eoa.slice(0, 12)}...`);
                            trade.walletAddress = eoa;
                            if (!trade.proxyWalletAddress) {
                                trade.proxyWalletAddress = deriveProxyAddress(eoa);
                            }
                        }
                    }
                }
            }
        }

        // Get market info
        const market = await this.marketService.getMarket(trade.marketId);
        if (market) {
            trade.marketTitle = market.title || 'Unknown Market';
            trade.marketCategory = market.category || 'other';
            trade.marketEndDate = market.endDate;
            trade.marketTotalVolume = market.volume;
            trade.marketLiquidity = market.liquidity;
            // Store slug for Polymarket URL construction in Discord alerts
            (trade as any).marketSlug = market.slug;
            (trade as any).eventSlug = market.eventSlug;
        } else {
            console.warn(`[TradeProcessor] Market not found for ${trade.marketId.slice(0, 10)}...`);
        }

        // Record trade for order flow analysis
        this.orderFlowTracker.recordTrade(trade);

        // Get wallet profile for noise detection
        // Use PROXY address for Polymarket profile lookup (profiles are indexed by proxy)
        const profileAddress = trade.proxyWalletAddress || trade.walletAddress;
        const walletProfile = await this.profiler.getProfile(profileAddress);

        // Calculate insider score
        const insiderScore = await this.scorer.calculateScore(trade);

        // Update wallet profile with this trade (use proxy for consistency)
        await this.profiler.updateWithTrade(profileAddress, trade);

        const isFlagged = insiderScore.isFlagged;
        const isWhale = trade.sizeUsd >= this.whaleThreshold;

        // Anomaly detection: high impact + fresh wallet OR cluster detected
        const breakdown = insiderScore.breakdown;
        const isAnomaly = (
            (breakdown.impact >= 8 && breakdown.walletAge >= 10) ||  // Price moved 10%+ AND wallet < 7 days
            breakdown.cluster >= 20                                    // Fresh wallet cluster detected
        );

        // Record metrics
        tradeCounter.inc({ category: trade.marketCategory, side: trade.side });
        if (isFlagged) {
            flaggedTradeCounter.inc({ confidence: insiderScore.confidence });
        }

        // Create default wallet profile if none exists
        const finalWalletProfile: WalletProfile = walletProfile || {
            address: trade.walletAddress,
            totalTrades: 1,
            totalPnl: 0,
            winRate: 0,
            avgTradeSize: trade.sizeUsd,
            marketsTraded: [{ id: trade.marketId, title: trade.marketTitle, category: trade.marketCategory }],
            firstSeen: trade.timestamp,
            lastActive: trade.timestamp,
            tags: [],
        };

        return {
            ...trade,
            insiderScore,
            walletProfile: finalWalletProfile,
            isWhale,
            isFlagged,
            isAnomaly,
            fundingSource: insiderScore.fundingSource,
        };
    }

    /**
     * Process multiple trades in batch (parallel with concurrency limit)
     */
    async processBatch(rawTrades: RawTrade[]): Promise<EnrichedTrade[]> {
        const BATCH_CONCURRENCY = 5;
        const results: EnrichedTrade[] = [];

        // Process in parallel chunks for better throughput
        for (let i = 0; i < rawTrades.length; i += BATCH_CONCURRENCY) {
            const chunk = rawTrades.slice(i, i + BATCH_CONCURRENCY);
            const chunkResults = await Promise.all(
                chunk.map(rawTrade => this.process(rawTrade))
            );

            // Filter out nulls and add to results
            for (const result of chunkResults) {
                if (result) {
                    results.push(result);
                }
            }
        }

        return results;
    }

    /**
     * Get processing statistics
     */
    getStats(): { threshold: number; categories: readonly string[] } {
        return {
            threshold: this.whaleThreshold,
            categories: config.targetCategories,
        };
    }
}
