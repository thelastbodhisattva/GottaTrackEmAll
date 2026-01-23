// ============================================================================
// Frontend Types (mirroring backend types)
// ============================================================================

export type MarketCategory = 'geopolitics' | 'war' | 'crypto' | 'other';
export type TradeSide = 'YES' | 'NO';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type ViewMode = 'efficiency' | 'neutral';

export interface ScoreBreakdown {
    walletAge: number;
    tradeSize: number;
    timing: number;
    diversification: number;
    onChainSource: number;
    specificity: number;
    impact: number;
    connections: number;
    orderFlow: number;  // Order flow pattern detection
    cluster: number;    // Fresh wallet cluster detection
    total: number;
}

export interface InsiderScore {
    breakdown: ScoreBreakdown;
    isFlagged: boolean;
    confidence: ConfidenceLevel;
    ethicsNote: string;
    calculatedAt: string;
}

export interface WalletProfile {
    address: string;
    totalTrades: number;
    totalPnl: number;
    winRate: number;
    avgTradeSize: number;
    marketsTraded: string[];
    firstSeen: string;
    lastActive: string;
    tags: string[];
}

export interface EnrichedTrade {
    id: string;
    walletAddress: string;             // EOA for analysis
    proxyWalletAddress?: string;       // Polymarket proxy for profile links
    marketId: string;
    marketTitle: string;
    marketCategory: MarketCategory;
    side: TradeSide;
    price: number;
    priceBefore: number;
    priceAfter: number;
    sizeUsd: number;
    shares: number;
    timestamp: string;
    transactionHash: string;
    insiderScore: InsiderScore;
    walletProfile: WalletProfile;
    isWhale: boolean;
    isFlagged: boolean;
}

export interface HansonQuote {
    text: string;
    source: string;
    year: number;
    url?: string;
}

export interface AppStats {
    totalTrades: number;
    flaggedTrades: number;
    totalVolume: number;
    trackedWallets: number;
    uptime: number;
}
