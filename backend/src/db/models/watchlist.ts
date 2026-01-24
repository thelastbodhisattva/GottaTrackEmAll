import { Schema, model, Document } from 'mongoose';

/**
 * Watchlist alert configuration
 */
export interface IWatchlistAlertConfig {
    minTradeSize: number;     // Minimum trade size in USD (default $100,000)
    minScore: number;         // Optional minimum insider score (0-100)
    categories: string[];     // Market categories to watch (empty = all)
    channels: ('discord')[];  // Alert channels
}

/**
 * Watchlist document interface for tracking specific wallets
 */
export interface IWatchlist extends Document {
    name: string;
    description?: string;
    wallets: string[];        // EOA or proxy addresses to watch
    alertConfig: IWatchlistAlertConfig;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const watchlistAlertConfigSchema = new Schema<IWatchlistAlertConfig>(
    {
        minTradeSize: { type: Number, default: 100000, min: 1000 },
        minScore: { type: Number, default: 0, min: 0, max: 100 },
        categories: { type: [String], default: [] },
        channels: { type: [String], default: ['discord'] },
    },
    { _id: false }
);

const watchlistSchema = new Schema<IWatchlist>(
    {
        name: { type: String, required: true, trim: true, maxlength: 100 },
        description: { type: String, trim: true, maxlength: 500 },
        wallets: {
            type: [String],
            required: true,
            validate: {
                validator: (v: string[]) => v.length > 0,
                message: 'Watchlist must have at least one wallet'
            }
        },
        alertConfig: { type: watchlistAlertConfigSchema, default: () => ({}) },
        isActive: { type: Boolean, default: true },
    },
    {
        timestamps: true,
    }
);

// Index for fast wallet lookups
watchlistSchema.index({ wallets: 1 });
// Index for active watchlists
watchlistSchema.index({ isActive: 1 });
// Compound index for wallet + active status
watchlistSchema.index({ wallets: 1, isActive: 1 });

export const Watchlist = model<IWatchlist>('Watchlist', watchlistSchema);
