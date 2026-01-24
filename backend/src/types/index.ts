// ============================================================================
// Core Types for Polymarket Whale Tracker
// ============================================================================

/** Market category for filtering */
export type MarketCategory = 'geopolitics' | 'war' | 'crypto' | 'sports' | 'esports' | 'popculture' | 'entertainment' | 'science' | 'other';

/** Trade side */
export type TradeSide = 'YES' | 'NO';

/** Confidence level for insider scoring */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

// ============================================================================
// Trade Types
// ============================================================================

/** Raw trade from Polymarket WebSocket */
export interface RawTrade {
    id: string;
    market: string;
    asset_id: string;
    side: string;
    price: string;
    size: string;
    maker_address: string;
    taker_address: string;
    timestamp: string;
    transaction_hash: string;
}

/** Processed trade with metadata */
export interface Trade {
    id: string;
    walletAddress: string;           // EOA (real user wallet) for analysis
    proxyWalletAddress?: string;     // Polymarket proxy address for profile links
    marketId: string;
    marketTitle: string;
    marketCategory: MarketCategory;
    side: TradeSide;
    price: number;
    priceBefore: number;
    priceAfter: number;
    sizeUsd: number;
    shares: number;
    timestamp: Date;
    marketAvgVolume: number;
    marketTotalVolume?: number;  // Total USD volume in market (for dominance detection)
    marketLiquidity?: number;    // Current market liquidity (for thin market detection)
    marketEndDate?: Date;  // Market resolution/end date for timing scoring
    transactionHash: string;
    resolved?: boolean;
    won?: boolean;
    payout?: number;
    cost?: number;
}

/** Trade enriched with insider score and wallet profile */
export interface EnrichedTrade extends Trade {
    insiderScore: InsiderScore;
    walletProfile: WalletProfile;
    isWhale: boolean;
    isFlagged: boolean;
    fundingSource?: {
        type: 'exchange' | 'bridge' | 'contract' | 'unknown';
        label: string;
    };
    marketSlug?: string;   // For constructing Polymarket market URL
    eventSlug?: string;    // For constructing Polymarket event URL
}

// ============================================================================
// Insider Scoring Types
// ============================================================================

/** Score breakdown for each factor */
export interface ScoreBreakdown {
    walletAge: number;       // 25 pts max - Fresh wallet detection + wc/tx speed
    tradeSize: number;       // 20 pts max - Abnormal size vs market avg
    timing: number;          // 30 pts max - Pre-news timing patterns
    diversification: number; // 18 pts max - Portfolio concentration + category focus + masking detection
    onChainSource: number;   // 15 pts max - CEX deposits, dormant reactivation
    specificity: number;     // 10 pts max - Date-specific outcomes
    impact: number;          // 10 pts max - Post-trade probability shift + low-liquidity whale
    connections: number;     // 15 pts max - Win rate + PnL stability
    orderFlow: number;       // 10 pts max - Accumulation/clustering patterns
    cluster: number;         // 15 pts max - Fresh wallet cluster detection
    velocity: number;        // 15 pts max - Burst trading (many trades in short window)
    proximity: number;       // 15 pts max - Trade timing close to event resolution
    total: number;           // Normalized 0-100
}

/** Full insider score with metadata */
export interface InsiderScore {
    breakdown: ScoreBreakdown;
    isFlagged: boolean;
    confidence: ConfidenceLevel;
    ethicsNote: string;
    calculatedAt: Date;
    /** 
     * List of factors that failed during calculation (returned 0 due to errors).
     * Empty array means all factors calculated successfully.
     * Used to indicate degraded/partial scoring mode.
     */
    degradedFactors?: ('diversification' | 'onChain' | 'connection' | 'cluster')[];
    /** Detected funding source from on-chain analysis */
    fundingSource?: {
        type: 'exchange' | 'bridge' | 'contract' | 'unknown';
        label: string;
    };
}

// ============================================================================
// Wallet Types
// ============================================================================

/** On-chain wallet data from Alchemy RPC (previously Polygonscan) */
export interface WalletData {
    address: string;
    createdAt: number;
    lastActiveBeforeTrade?: number;
    balance: number;
    txCount: number;
    fundingSource?: {
        type: 'exchange' | 'wallet' | 'contract' | 'unknown';
        address?: string;
        label?: string;
    };
}

/** Wallet position in a market */
export interface WalletPosition {
    marketId: string;
    marketTitle: string;
    side: TradeSide;
    shares: number;
    avgPrice: number;
    value: number;
    pnl: number;
}

/** Market traded info for category analysis */
export interface MarketTraded {
    id: string;
    title?: string;  // Title for cross-market correlation analysis
    category?: string;
}

/** Wallet profile with performance metrics */
export interface WalletProfile {
    address: string;
    totalTrades: number;
    totalPnl: number;
    winRate: number;
    avgTradeSize: number;
    marketsTraded: MarketTraded[];  // Changed from string[] to include category
    firstSeen: Date;
    lastActive: Date;
    tags: string[];
}

// ============================================================================
// Market Types
// ============================================================================

/** Market metadata */
export interface Market {
    id: string;
    conditionId: string;
    questionId: string;
    title: string;
    description: string;
    category: MarketCategory;
    outcomes: string[];
    endDate: Date;
    volume: number;
    liquidity: number;
    lastPrice: number;
    resolved: boolean;
    resolutionOutcome?: string;
    slug?: string;        // Market slug for URL construction
    eventSlug?: string;   // Event slug (some markets are grouped under events)
}

// ============================================================================
// Alert Types
// ============================================================================

/** Alert configuration */
export interface AlertConfig {
    discordWebhook: string;
    minScoreThreshold: number;
    enabledCategories: MarketCategory[];
    showEthicsNotes: boolean;
}

/** Alert payload */
export interface AlertPayload {
    trade: EnrichedTrade;
    showEthics: boolean;
    urgency: 'low' | 'medium' | 'high';
}

// ============================================================================
// API Response Types
// ============================================================================

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

/** API error response */
export interface ApiError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

/** WebSocket subscription message */
export interface WsSubscribeMessage {
    type: 'subscribe';
    channel: 'trades' | 'orderbook' | 'price';
    market?: string;
    assets_ids?: string[];
}

/** WebSocket trade event */
export interface WsTradeEvent {
    event_type: 'trade';
    data: RawTrade;
}
