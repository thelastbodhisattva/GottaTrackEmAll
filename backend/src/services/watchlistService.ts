import { Watchlist, IWatchlist, IWatchlistAlertConfig } from '../db/index.js';
import { isMongoDBConnected } from '../db/index.js';

/**
 * DTO for creating a watchlist
 */
export interface CreateWatchlistDTO {
    name: string;
    description?: string;
    wallets: string[];
    alertConfig?: Partial<IWatchlistAlertConfig>;
}

/**
 * DTO for updating a watchlist
 */
export interface UpdateWatchlistDTO {
    name?: string;
    description?: string;
    wallets?: string[];
    alertConfig?: Partial<IWatchlistAlertConfig>;
    isActive?: boolean;
}

/**
 * Service for managing whale watchlists
 * Handles CRUD operations and wallet lookups for alert triggering
 */
export class WatchlistService {
    /**
     * Create a new watchlist
     */
    async create(data: CreateWatchlistDTO): Promise<IWatchlist> {
        if (!isMongoDBConnected()) {
            throw new Error('MongoDB not connected');
        }

        // Normalize wallet addresses to lowercase
        const normalizedWallets = data.wallets.map(w => w.toLowerCase());

        const watchlist = new Watchlist({
            name: data.name,
            description: data.description,
            wallets: normalizedWallets,
            alertConfig: {
                minTradeSize: data.alertConfig?.minTradeSize ?? 100000,
                minScore: data.alertConfig?.minScore ?? 0,
                categories: data.alertConfig?.categories ?? [],
                channels: data.alertConfig?.channels ?? ['discord'],
            },
            isActive: true,
        });

        await watchlist.save();
        console.log(`[WatchlistService] Created watchlist "${data.name}" with ${normalizedWallets.length} wallets`);
        return watchlist;
    }

    /**
     * Get all watchlists
     */
    async getAll(): Promise<IWatchlist[]> {
        if (!isMongoDBConnected()) {
            return [];
        }
        return Watchlist.find().sort({ createdAt: -1 });
    }

    /**
     * Get a single watchlist by ID
     */
    async getById(id: string): Promise<IWatchlist | null> {
        if (!isMongoDBConnected()) {
            return null;
        }
        return Watchlist.findById(id);
    }

    /**
     * Update a watchlist
     */
    async update(id: string, data: UpdateWatchlistDTO): Promise<IWatchlist | null> {
        if (!isMongoDBConnected()) {
            throw new Error('MongoDB not connected');
        }

        const updateData: Record<string, unknown> = {};

        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;

        if (data.wallets !== undefined) {
            updateData.wallets = data.wallets.map(w => w.toLowerCase());
        }

        if (data.alertConfig !== undefined) {
            // Merge with existing config using $set on nested fields
            Object.entries(data.alertConfig).forEach(([key, value]) => {
                updateData[`alertConfig.${key}`] = value;
            });
        }

        const watchlist = await Watchlist.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (watchlist) {
            console.log(`[WatchlistService] Updated watchlist "${watchlist.name}"`);
        }
        return watchlist;
    }

    /**
     * Delete a watchlist
     */
    async delete(id: string): Promise<boolean> {
        if (!isMongoDBConnected()) {
            throw new Error('MongoDB not connected');
        }

        const result = await Watchlist.findByIdAndDelete(id);
        if (result) {
            console.log(`[WatchlistService] Deleted watchlist "${result.name}"`);
            return true;
        }
        return false;
    }

    /**
     * Find all active watchlists that contain a specific wallet address
     * Used by TradeProcessor to check if incoming trade should trigger alert
     */
    async findWatchlistsForWallet(walletAddress: string): Promise<IWatchlist[]> {
        if (!isMongoDBConnected()) {
            return [];
        }

        const normalized = walletAddress.toLowerCase();

        return Watchlist.find({
            wallets: normalized,
            isActive: true,
        });
    }

    /**
     * Add wallets to an existing watchlist
     */
    async addWallets(id: string, wallets: string[]): Promise<IWatchlist | null> {
        if (!isMongoDBConnected()) {
            throw new Error('MongoDB not connected');
        }

        const normalized = wallets.map(w => w.toLowerCase());

        const watchlist = await Watchlist.findByIdAndUpdate(
            id,
            { $addToSet: { wallets: { $each: normalized } } },
            { new: true }
        );

        if (watchlist) {
            console.log(`[WatchlistService] Added ${wallets.length} wallets to "${watchlist.name}"`);
        }
        return watchlist;
    }

    /**
     * Remove wallets from a watchlist
     */
    async removeWallets(id: string, wallets: string[]): Promise<IWatchlist | null> {
        if (!isMongoDBConnected()) {
            throw new Error('MongoDB not connected');
        }

        const normalized = wallets.map(w => w.toLowerCase());

        const watchlist = await Watchlist.findByIdAndUpdate(
            id,
            { $pull: { wallets: { $in: normalized } } },
            { new: true }
        );

        if (watchlist) {
            console.log(`[WatchlistService] Removed ${wallets.length} wallets from "${watchlist.name}"`);
        }
        return watchlist;
    }

    /**
     * Get watchlist statistics
     */
    async getStats(): Promise<{ total: number; active: number; totalWallets: number }> {
        if (!isMongoDBConnected()) {
            return { total: 0, active: 0, totalWallets: 0 };
        }

        const [stats] = await Watchlist.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: ['$isActive', 1, 0] } },
                    totalWallets: { $sum: { $size: '$wallets' } },
                },
            },
        ]);

        return stats || { total: 0, active: 0, totalWallets: 0 };
    }
}
