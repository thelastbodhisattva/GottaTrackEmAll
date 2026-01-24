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
import { PolygonRpcClient } from '../clients/polygonRpc.js';
import { tradeCounter, flaggedTradeCounter } from '../middleware/metrics.js';
import { recordTradeForVelocity } from '../cache/redis.js';

/**
 * Trade processor that filters, enriches, and scores whale trades
 */
export class TradeProcessor {
    private readonly whaleThreshold: number;

    // Replay protection: track recently processed trade IDs
    private processedTradeIds = new Map<string, number>(); // tradeId -> timestamp
    private readonly replayWindowMs = 60 * 60 * 1000; // 1 hour window
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

        if (cleaned > 0) {
            console.log(`[TradeProcessor] Cleaned up ${cleaned} old trade IDs, ${this.processedTradeIds.size} remaining`);
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
     * Process a raw trade from WebSocket
     * Returns enriched trade if it meets whale threshold, null otherwise
     */
    async process(rawTrade: RawTrade): Promise<EnrichedTrade | null> {
        // Parse raw trade
        const trade = this.parseRawTrade(rawTrade);
        if (!trade) {
            return null;
        }

        // Atomic replay protection: skip if already processed
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

            // Try to get txHash from Data API if we don't have it
            let txHash = trade.transactionHash;
            let proxyWallet: string | null = null;

            if (!txHash) {
                const recentTrades = await this.marketService.getRecentTrades(trade.marketId, 10);

                // Log what we got for debugging
                console.log(`[TradeProcessor] Looking for trade: size=${trade.shares}, price=${trade.price}`);

                // Find a trade matching our size/price with percentage tolerance
                for (const apiTrade of recentTrades) {
                    const t = apiTrade as any;
                    const apiSize = parseFloat(t.size);
                    const apiPrice = parseFloat(t.price);

                    // Use 10% tolerance for size matching and 5% for price
                    const sizeTolerance = trade.shares * 0.1;
                    const priceTolerance = Math.max(trade.price * 0.05, 0.01);

                    const sizeMatch = Math.abs(apiSize - trade.shares) < sizeTolerance;
                    const priceMatch = Math.abs(apiPrice - trade.price) < priceTolerance;

                    // Check both camelCase and snake_case field names
                    const apiTxHash = t.transactionHash || t.transaction_hash;
                    const apiProxyWallet = t.proxyWallet || t.proxy_wallet || t.maker_address || t.taker_address;

                    if (sizeMatch && priceMatch && apiTxHash) {
                        txHash = apiTxHash;
                        proxyWallet = apiProxyWallet || null;
                        console.log(`[TradeProcessor] ✅ Matched trade: API size=${apiSize}, price=${apiPrice}`);
                        break;
                    }
                }

                // Fallback: If no match found, use the most recent API trade with a txHash
                if (!txHash && recentTrades.length > 0) {
                    // Find the first trade with a transactionHash
                    for (const apiTrade of recentTrades) {
                        const t = apiTrade as any;
                        const apiTxHash = t.transactionHash || t.transaction_hash;
                        if (apiTxHash) {
                            txHash = apiTxHash;
                            proxyWallet = t.proxyWallet || t.proxy_wallet || t.maker_address || t.taker_address || null;
                            console.log(`[TradeProcessor] ⚡ Using txHash from API trade: ${txHash.slice(0, 12)}...`);
                            break;
                        }
                    }

                    // Also grab proxy wallet from API if available
                    const firstTrade = recentTrades[0] as any;
                    if (!proxyWallet) {
                        proxyWallet = firstTrade.proxyWallet || firstTrade.proxy_wallet
                            || firstTrade.maker_address || firstTrade.taker_address || null;
                    }
                    if (proxyWallet) {
                        console.log(`[TradeProcessor] ⚡ Got proxy wallet: ${proxyWallet.slice(0, 10)}...`);
                        trade.proxyWalletAddress = proxyWallet; // Store for Polymarket profile link
                    }
                }

                if (txHash) {
                    console.log(`[TradeProcessor] Got txHash: ${txHash.slice(0, 12)}...`);
                    trade.transactionHash = txHash;
                } else {
                    console.log(`[TradeProcessor] ⚠️ No txHash found in ${recentTrades.length} API trades`);
                }
            }

            // Store proxy wallet for Polymarket profile link BEFORE overwriting with EOA
            if (proxyWallet && !trade.proxyWalletAddress) {
                trade.proxyWalletAddress = proxyWallet;
            }

            // Use Alchemy to get real EOA from transaction
            if (txHash) {
                const eoa = await this.polygonRpc.getEoaFromTx(txHash);
                if (eoa) {
                    console.log(`[TradeProcessor] ✅ Got REAL EOA from tx.from: ${eoa.slice(0, 12)}...`);
                    console.log(`[TradeProcessor] 📦 Stored proxy for Polymarket: ${proxyWallet?.slice(0, 12) || 'N/A'}...`);
                    trade.walletAddress = eoa;
                }
            }

            // FALLBACK: If still no wallet, try to find EOA from proxy address via Alchemy
            if (!trade.walletAddress && this.polygonRpc) {
                // Try to get ANY wallet address from the WebSocket trade data
                const rawTrade = trade as any;
                const proxyAddress = rawTrade.maker_address || rawTrade.taker_address
                    || rawTrade.maker || rawTrade.taker;

                if (proxyAddress) {
                    console.log(`[TradeProcessor] 🔍 Looking up EOA from proxy: ${proxyAddress.slice(0, 10)}...`);
                    const eoa = await this.polygonRpc.getEoaFromProxyAddress(proxyAddress);
                    if (eoa) {
                        console.log(`[TradeProcessor] ✅ Got REAL EOA from proxy lookup: ${eoa.slice(0, 12)}...`);
                        trade.walletAddress = eoa;
                    }
                }
            }

            // FINAL FALLBACK: Query on-chain OrderFilled events for this asset
            if (!trade.walletAddress && this.polygonRpc) {
                console.log(`[TradeProcessor] 🔗 Searching on-chain for trade...`);
                const eoa = await this.polygonRpc.findRecentTradeEoa(trade.marketId, trade.shares, 200);
                if (eoa) {
                    console.log(`[TradeProcessor] ✅ Got REAL EOA from on-chain events: ${eoa.slice(0, 12)}...`);
                    trade.walletAddress = eoa;
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
            fundingSource: insiderScore.fundingSource,
        };
    }

    /**
     * Process multiple trades in batch
     */
    async processBatch(rawTrades: RawTrade[]): Promise<EnrichedTrade[]> {
        const results: EnrichedTrade[] = [];

        for (const rawTrade of rawTrades) {
            const result = await this.process(rawTrade);
            if (result) {
                results.push(result);
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
