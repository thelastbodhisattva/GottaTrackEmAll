import { Trade, WalletProfile } from '../types/index.js';
import { PolymarketProfileClient } from '../clients/polymarketProfile.js';

/**
 * Memory-bounded wallet profile store with LRU eviction
 * Prevents unbounded memory growth in long-running deployments
 */
const WALLET_STORE_MAX_SIZE = 5000;

/**
 * Wallet profile with access tracking for LRU eviction
 */
interface TrackedWalletProfile extends WalletProfile {
    _lastAccessed: number;
}

const walletStore = new Map<string, TrackedWalletProfile>();

/**
 * Evict oldest entries when store exceeds max size
 * Uses LRU (Least Recently Used) strategy based on _lastAccessed timestamp
 */
function evictOldestEntries(count: number = 100): void {
    if (walletStore.size <= WALLET_STORE_MAX_SIZE) return;

    // Get all entries sorted by last accessed time (oldest first)
    const entries = Array.from(walletStore.entries())
        .sort((a, b) => a[1]._lastAccessed - b[1]._lastAccessed);

    // Evict the oldest entries
    for (let i = 0; i < Math.min(count, entries.length); i++) {
        walletStore.delete(entries[i][0]);
    }

    console.log(`[WalletProfiler] Evicted ${count} stale entries, ${walletStore.size} remaining`);
}

/**
 * Wallet profiler that builds and maintains performance metrics
 * Accepts injected PolymarketProfileClient to avoid duplicate instances
 */
export class WalletProfiler {
    private polymarketClient: PolymarketProfileClient;

    constructor(polymarketClient?: PolymarketProfileClient) {
        // Use injected client or create fallback (for backwards compatibility)
        this.polymarketClient = polymarketClient || new PolymarketProfileClient();
    }

    /**
     * Add a profile to the store with LRU eviction if needed
     */
    private setProfile(address: string, profile: WalletProfile): void {
        const trackedProfile: TrackedWalletProfile = {
            ...profile,
            _lastAccessed: Date.now(),
        };

        // Evict old entries if we're at capacity
        if (walletStore.size >= WALLET_STORE_MAX_SIZE) {
            evictOldestEntries(100);
        }

        walletStore.set(address, trackedProfile);
    }

    /**
     * Get wallet profile, fetching from Polymarket if not cached
     */
    async getProfile(address: string): Promise<WalletProfile> {
        const normalizedAddr = address.toLowerCase();

        // Check local cache
        const existing = walletStore.get(normalizedAddr);
        if (existing && existing.totalTrades > 0) {
            // Update access time for LRU tracking
            existing._lastAccessed = Date.now();
            return existing;
        }

        // Try to fetch from Polymarket API (uses shared client)
        const apiProfile = await this.polymarketClient.getWalletProfile(address);
        if (apiProfile && apiProfile.totalTrades > 0) {
            this.setProfile(normalizedAddr, apiProfile);
            return apiProfile;
        }

        // Create new profile if not found
        if (!existing) {
            const profile: WalletProfile = {
                address: normalizedAddr,
                totalTrades: 0,
                totalPnl: 0,
                winRate: 0,
                avgTradeSize: 0,
                marketsTraded: [],
                firstSeen: new Date(),
                lastActive: new Date(),
                tags: [],
            };
            this.setProfile(normalizedAddr, profile);
            return profile;
        }

        // Update access time for LRU tracking
        existing._lastAccessed = Date.now();
        return existing;
    }


    /**
     * Update profile with a new trade
     */
    async updateWithTrade(address: string, trade: Trade): Promise<void> {
        const profile = await this.getProfile(address);

        // Update trade count
        profile.totalTrades += 1;

        // Update average trade size
        profile.avgTradeSize =
            (profile.avgTradeSize * (profile.totalTrades - 1) + trade.sizeUsd) /
            profile.totalTrades;

        // Add market if not already tracked
        const marketExists = profile.marketsTraded.some(m => m.id === trade.marketId);
        if (!marketExists) {
            profile.marketsTraded.push({ id: trade.marketId, category: trade.marketCategory });
        }

        // Update last active
        profile.lastActive = new Date();

        this.setProfile(address.toLowerCase(), profile);
    }

    /**
     * Update profile with trade resolution (for PNL tracking)
     */
    async updateWithResolution(
        address: string,
        trade: Trade,
        won: boolean,
        payout: number
    ): Promise<void> {
        const profile = await this.getProfile(address);

        // Calculate PNL for this trade
        const cost = trade.sizeUsd;
        const pnl = won ? payout - cost : -cost;

        // Update total PNL
        profile.totalPnl += pnl;

        // Update win rate (simplified - would track wins/losses separately)
        // For now, estimate based on PNL trend
        const totalResolvedTrades = profile.totalTrades; // Approximate
        if (totalResolvedTrades > 0) {
            const estimatedWins = (profile.totalPnl > 0)
                ? Math.ceil(totalResolvedTrades * 0.55) // Profitable = ~55% win rate
                : Math.floor(totalResolvedTrades * 0.45); // Unprofitable = ~45% win rate
            profile.winRate = estimatedWins / totalResolvedTrades;
        }

        this.setProfile(address.toLowerCase(), profile);
    }

    /**
     * Get top wallets by PNL
     */
    async getLeaderboard(limit: number = 20): Promise<WalletProfile[]> {
        const profiles = Array.from(walletStore.values());

        return profiles
            .sort((a, b) => b.totalPnl - a.totalPnl)
            .slice(0, limit);
    }

    /**
     * Get wallets by tag
     */
    async getByTag(tag: string): Promise<WalletProfile[]> {
        const profiles = Array.from(walletStore.values());
        return profiles.filter(p => p.tags.includes(tag));
    }

    /**
     * Get flagged wallets
     */
    async getFlagged(): Promise<WalletProfile[]> {
        return this.getByTag('insider-flagged');
    }

    /**
     * Search wallets by address prefix
     */
    async searchByAddress(prefix: string): Promise<WalletProfile[]> {
        const normalizedPrefix = prefix.toLowerCase();
        const profiles = Array.from(walletStore.values());

        return profiles.filter(p =>
            p.address.toLowerCase().startsWith(normalizedPrefix)
        );
    }

    /**
     * Get total tracked wallets count
     */
    async getTotalCount(): Promise<number> {
        return walletStore.size;
    }

    /**
     * Clear all profiles (for testing)
     */
    async clear(): Promise<void> {
        walletStore.clear();
    }
}
