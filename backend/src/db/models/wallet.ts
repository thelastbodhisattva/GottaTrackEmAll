import { Schema, model, Document } from 'mongoose';

/**
 * Wallet document interface
 */
export interface IWallet extends Document {
    address: string;
    totalTrades: number;
    flaggedTrades: number;
    totalPnl: number;
    winRate: number;
    flaggedWinRate: number;
    avgInsiderScore: number;
    firstSeen: Date;
    lastActive: Date;
    tags: string[];
    // Cluster detection
    connectedWallets: string[];
    fundingSource: string | null;
    clusterScore: number;
    createdAt: Date;
    updatedAt: Date;
}

const walletSchema = new Schema<IWallet>(
    {
        address: { type: String, required: true, unique: true, index: true },
        totalTrades: { type: Number, default: 0 },
        flaggedTrades: { type: Number, default: 0 },
        totalPnl: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 },
        flaggedWinRate: { type: Number, default: 0 },
        avgInsiderScore: { type: Number, default: 0 },
        firstSeen: { type: Date, default: Date.now },
        lastActive: { type: Date, default: Date.now },
        tags: { type: [String], default: [] },
        connectedWallets: { type: [String], default: [] },
        fundingSource: { type: String, default: null },
        clusterScore: { type: Number, default: 0 },
    },
    {
        timestamps: true,
    }
);

// Indexes for leaderboard and analysis queries
walletSchema.index({ flaggedTrades: -1 });
walletSchema.index({ winRate: -1 });
walletSchema.index({ flaggedWinRate: -1 });
walletSchema.index({ avgInsiderScore: -1 });
walletSchema.index({ clusterScore: -1 });

export const Wallet = model<IWallet>('Wallet', walletSchema);
