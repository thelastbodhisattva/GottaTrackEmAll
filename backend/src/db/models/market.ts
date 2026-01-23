import { Schema, model, Document } from 'mongoose';

/**
 * Market document interface for outcome tracking
 */
export interface IMarket extends Document {
    marketId: string;
    title: string;
    category: string;
    endDate: Date | null;
    resolved: boolean;
    outcome: 'YES' | 'NO' | null;
    resolvedAt: Date | null;
    tradeCount: number;
    flaggedTradeCount: number;
    createdAt: Date;
    updatedAt: Date;
}

const marketSchema = new Schema<IMarket>(
    {
        marketId: { type: String, required: true, unique: true, index: true },
        title: { type: String, required: true },
        category: { type: String, required: true },
        endDate: { type: Date, default: null },
        resolved: { type: Boolean, default: false, index: true },
        outcome: { type: String, enum: ['YES', 'NO', null], default: null },
        resolvedAt: { type: Date, default: null },
        tradeCount: { type: Number, default: 0 },
        flaggedTradeCount: { type: Number, default: 0 },
    },
    {
        timestamps: true,
    }
);

// Index for resolution polling
marketSchema.index({ resolved: 1, endDate: 1 });

export const Market = model<IMarket>('Market', marketSchema);
