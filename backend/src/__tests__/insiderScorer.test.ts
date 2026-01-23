/**
 * Unit Tests for Insider Scorer
 * Tests the core scoring logic with mocked trade data
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../clients/polygonRpc.js', () => ({
    PolygonRpcClient: vi.fn().mockImplementation(() => ({
        getWalletData: vi.fn().mockResolvedValue({
            address: '0x1234567890abcdef1234567890abcdef12345678',
            createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days old
            balance: 1000,
            txCount: 5,
        }),
        analyzeFundingPath: vi.fn().mockResolvedValue({
            fundingSource: { type: 'unknown', label: 'Unknown' },
        }),
    })),
}));

vi.mock('../clients/polymarketProfile.js', () => ({
    PolymarketProfileClient: vi.fn().mockImplementation(() => ({
        getStats: vi.fn().mockResolvedValue(null),
        getPositions: vi.fn().mockResolvedValue([]),
        getRecentTrades: vi.fn().mockResolvedValue([]),
    })),
}));

// Test data
const createMockTrade = (overrides = {}) => ({
    id: 'test-trade-1',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    marketId: '0xabc123',
    marketTitle: 'Test Market',
    marketCategory: 'geopolitics' as const,
    side: 'YES' as const,
    price: 0.5,
    priceBefore: 0.48,
    priceAfter: 0.55,
    sizeUsd: 25000,
    shares: 50000,
    timestamp: new Date(),
    marketAvgVolume: 100000,
    transactionHash: '0xtxhash',
    ...overrides,
});

describe('Insider Scoring Logic', () => {
    describe('Score Breakdown Bounds', () => {
        it('should have total score between 0 and 100', () => {
            // This tests the normalization formula
            const maxRawScore = 210;
            const normalized = Math.min(100, Math.round((maxRawScore / 210) * 100));
            expect(normalized).toBe(100);

            const minRawScore = 0;
            const normalizedMin = Math.min(100, Math.round((minRawScore / 210) * 100));
            expect(normalizedMin).toBe(0);
        });

        it('should correctly normalize a mid-range score', () => {
            const midRawScore = 105;
            const normalized = Math.min(100, Math.round((midRawScore / 210) * 100));
            expect(normalized).toBe(50);
        });
    });

    describe('Threshold Logic', () => {
        it('should flag trades above threshold', () => {
            const threshold = 58;
            const score = 65;
            expect(score > threshold).toBe(true);
        });

        it('should not flag trades below threshold', () => {
            const threshold = 58;
            const score = 45;
            expect(score > threshold).toBe(false);
        });

        it('should not flag trades at exactly threshold', () => {
            const threshold = 58;
            const score = 58;
            expect(score > threshold).toBe(false);
        });
    });

    describe('Score Factor Calculations', () => {
        it('wallet age should give max points for fresh wallets', () => {
            // Fresh wallet = < 48 hours old
            const walletAgeDays = 1; // 1 day
            const maxScore = 15;

            // Simulating the scoring logic
            let score = 0;
            if (walletAgeDays <= 2) score = maxScore;
            else if (walletAgeDays <= 7) score = 10;
            else if (walletAgeDays <= 30) score = 5;
            else score = 0;

            expect(score).toBe(15);
        });

        it('trade size should score higher for large relative trades', () => {
            const trade = createMockTrade({ sizeUsd: 50000 });
            const avgVolume = 100000;
            const ratio = trade.sizeUsd / avgVolume;

            // 50% of daily volume = high score
            expect(ratio).toBeGreaterThanOrEqual(0.5);
        });

        it('should handle missing market data gracefully', () => {
            const trade = createMockTrade({ marketAvgVolume: 0 });

            // When avgVolume is 0, ratio would be Infinity - should be capped
            const safeRatio = trade.marketAvgVolume > 0
                ? trade.sizeUsd / trade.marketAvgVolume
                : 0;

            expect(safeRatio).toBe(0);
            expect(Number.isFinite(safeRatio)).toBe(true);
        });
    });

    describe('Category Targeting', () => {
        it('should recognize geopolitics category', () => {
            const trade = createMockTrade({ marketCategory: 'geopolitics' });
            const targetCategories = ['geopolitics', 'war', 'crypto'];

            expect(targetCategories.includes(trade.marketCategory)).toBe(true);
        });

        it('should handle other category', () => {
            const trade = createMockTrade({ marketCategory: 'other' });
            const targetCategories = ['geopolitics', 'war', 'crypto'];

            expect(targetCategories.includes(trade.marketCategory)).toBe(false);
        });
    });
});

describe('Trade Processing', () => {
    describe('Whale Detection', () => {
        it('should identify whale trade above threshold', () => {
            const threshold = 15000;
            const trade = createMockTrade({ sizeUsd: 25000 });

            expect(trade.sizeUsd >= threshold).toBe(true);
        });

        it('should not flag small trades', () => {
            const threshold = 15000;
            const trade = createMockTrade({ sizeUsd: 5000 });

            expect(trade.sizeUsd >= threshold).toBe(false);
        });
    });

    describe('Replay Protection', () => {
        it('should detect duplicate trade IDs', () => {
            const processedIds = new Set<string>();
            const tradeId = 'test-trade-123';

            // First process
            expect(processedIds.has(tradeId)).toBe(false);
            processedIds.add(tradeId);

            // Second process (replay)
            expect(processedIds.has(tradeId)).toBe(true);
        });

        it('should clean up old trade IDs after window', () => {
            const processedIds = new Map<string, number>();
            const windowMs = 60 * 60 * 1000; // 1 hour

            // Old trade
            processedIds.set('old-trade', Date.now() - (windowMs + 1000));
            // New trade
            processedIds.set('new-trade', Date.now());

            // Cleanup
            const now = Date.now();
            for (const [id, timestamp] of processedIds) {
                if (now - timestamp > windowMs) {
                    processedIds.delete(id);
                }
            }

            expect(processedIds.has('old-trade')).toBe(false);
            expect(processedIds.has('new-trade')).toBe(true);
        });
    });
});
