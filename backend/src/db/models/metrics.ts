import { Schema, model, Document } from 'mongoose';

/**
 * Daily metrics snapshot for algorithm validation
 */
export interface IMetrics extends Document {
    date: Date;
    totalTrades: number;
    flaggedTrades: number;
    flaggedWinRate: number;
    baselineWinRate: number;
    lift: number; // flaggedWinRate - baselineWinRate
    avgScore: number;
    resolvedFlaggedTrades: number;
    resolvedBaselineTrades: number;
    // Factor contribution analysis
    topFactors: Array<{
        name: string;
        avgContribution: number;
    }>;
    createdAt: Date;
}

const metricsSchema = new Schema<IMetrics>(
    {
        date: { type: Date, required: true, unique: true, index: true },
        totalTrades: { type: Number, default: 0 },
        flaggedTrades: { type: Number, default: 0 },
        flaggedWinRate: { type: Number, default: 0 },
        baselineWinRate: { type: Number, default: 0 },
        lift: { type: Number, default: 0 },
        avgScore: { type: Number, default: 0 },
        resolvedFlaggedTrades: { type: Number, default: 0 },
        resolvedBaselineTrades: { type: Number, default: 0 },
        topFactors: [
            {
                name: { type: String },
                avgContribution: { type: Number },
            },
        ],
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

export const Metrics = model<IMetrics>('Metrics', metricsSchema);
