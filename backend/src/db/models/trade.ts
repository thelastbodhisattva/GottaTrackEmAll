import { Schema, model, Document } from 'mongoose';

/**
 * Trade document interface
 */
export interface ITrade extends Document {
    tradeId: string;
    walletAddress: string;
    marketId: string;
    marketTitle: string;
    marketCategory: string;
    side: 'YES' | 'NO';
    price: number;
    sizeUsd: number;
    timestamp: Date;
    insiderScore: {
        total: number;
        breakdown: {
            walletAge: number;
            tradeSize: number;
            timing: number;
            diversification: number;
            onChainSource: number;
            specificity: number;
            impact: number;
            connections: number;
            orderFlow: number;
            cluster: number;
        };
        isFlagged: boolean;
        confidence: string;
    };
    // Outcome tracking (updated when market resolves)
    marketResolved: boolean;
    marketOutcome: 'YES' | 'NO' | null;
    tradeWon: boolean | null;
    pnl: number | null;
    // Pre-announcement tracking (updated asynchronously)
    preAnnouncementScore: number;
    priceAfter1h: number | null;
    priceMovePercent: number | null;
    createdAt: Date;
    updatedAt: Date;
}

const tradeSchema = new Schema<ITrade>(
    {
        tradeId: { type: String, required: true, unique: true, index: true },
        walletAddress: { type: String, required: true, index: true },
        marketId: { type: String, required: true, index: true },
        marketTitle: { type: String, required: true },
        marketCategory: { type: String, required: true },
        side: { type: String, enum: ['YES', 'NO'], required: true },
        price: { type: Number, required: true },
        sizeUsd: { type: Number, required: true },
        timestamp: { type: Date, required: true, index: true },
        insiderScore: {
            total: { type: Number, default: 0 },
            breakdown: {
                walletAge: { type: Number, default: 0 },
                tradeSize: { type: Number, default: 0 },
                timing: { type: Number, default: 0 },
                diversification: { type: Number, default: 0 },
                onChainSource: { type: Number, default: 0 },
                specificity: { type: Number, default: 0 },
                impact: { type: Number, default: 0 },
                connections: { type: Number, default: 0 },
                orderFlow: { type: Number, default: 0 },
                cluster: { type: Number, default: 0 },
            },
            isFlagged: { type: Boolean, default: false },
            confidence: { type: String, default: 'low' },
        },
        marketResolved: { type: Boolean, default: false, index: true },
        marketOutcome: { type: String, enum: ['YES', 'NO', null], default: null },
        tradeWon: { type: Boolean, default: null },
        pnl: { type: Number, default: null },
        // Pre-announcement tracking (updated asynchronously)
        preAnnouncementScore: { type: Number, default: 0 },
        priceAfter1h: { type: Number, default: null },
        priceMovePercent: { type: Number, default: null },
    },
    {
        timestamps: true,
    }
);

// Compound indexes for common queries
tradeSchema.index({ walletAddress: 1, timestamp: -1 });
tradeSchema.index({ marketId: 1, 'insiderScore.isFlagged': 1 });
tradeSchema.index({ 'insiderScore.isFlagged': 1, marketResolved: 1 });

// Indexes for cluster detection (findSynchronizedTrades)
// Used for: finding trades on same market/side within time window
tradeSchema.index({ marketId: 1, side: 1, timestamp: -1 });

// Indexes for filtered trade listings (GET /api/trades)
tradeSchema.index({ marketCategory: 1, timestamp: -1 });
tradeSchema.index({ 'insiderScore.isFlagged': 1, timestamp: -1 });
tradeSchema.index({ marketCategory: 1, 'insiderScore.isFlagged': 1, timestamp: -1 });

export const Trade = model<ITrade>('Trade', tradeSchema);
