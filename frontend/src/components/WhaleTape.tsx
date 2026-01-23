import { useState, useMemo } from 'react';
import { EnrichedTrade, MarketCategory } from '../types';
import { ScoreDonut } from './ScoreDonut';

interface WhaleTapeProps {
    trades: EnrichedTrade[];
    categoryFilter: MarketCategory | 'all';
    flaggedOnly: boolean;
    bookmarkedWallets?: Set<string>;
    onBookmarkToggle?: (address: string) => void;
}

// Factor labels for expanded row display
const FACTOR_LABELS: Record<string, string> = {
    walletAge: 'Wallet Age',
    tradeSize: 'Trade Size',
    timing: 'Timing',
    diversification: 'Concentration',
    onChainSource: 'On-Chain',
    specificity: 'Specificity',
    impact: 'Impact',
    connections: 'Win Rate',
    orderFlow: 'Order Flow',
    cluster: 'Cluster',
};

// Category icons for visual differentiation
const CATEGORY_ICONS: Record<string, string> = {
    geopolitics: '🏛️',
    politics: '🏛️',
    war: '⚔️',
    crypto: '💰',
    sports: '⚽',
    finance: '📊',
    entertainment: '🎬',
    science: '🔬',
    other: '🌍',
};

// Number of trades per page
const TRADES_PER_PAGE = 25;

export function WhaleTape({
    trades,
    categoryFilter,
    flaggedOnly,
    bookmarkedWallets = new Set(),
    onBookmarkToggle,
}: WhaleTapeProps) {
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);

    // Apply filters
    const filteredTrades = useMemo(() => {
        return trades.filter((trade) => {
            if (categoryFilter !== 'all' && trade.marketCategory !== categoryFilter) {
                return false;
            }
            if (flaggedOnly && !trade.isFlagged) {
                return false;
            }
            return true;
        });
    }, [trades, categoryFilter, flaggedOnly]);

    // Pagination
    const totalPages = Math.ceil(filteredTrades.length / TRADES_PER_PAGE);
    const paginatedTrades = useMemo(() => {
        const start = (currentPage - 1) * TRADES_PER_PAGE;
        return filteredTrades.slice(start, start + TRADES_PER_PAGE);
    }, [filteredTrades, currentPage]);

    // Relative time formatter
    const formatRelativeTime = (timestamp: string): string => {
        const now = new Date();
        const then = new Date(timestamp);
        const diffMs = now.getTime() - then.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) return `${diffSecs}s ago`;
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const formatSize = (size: number): string => {
        if (size >= 1000000) return `$${(size / 1000000).toFixed(1)}M`;
        if (size >= 1000) return `$${(size / 1000).toFixed(1)}K`;
        return `$${size.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    };

    const formatPrice = (price: number): string => {
        return `${(price * 100).toFixed(1)}%`;
    };

    const truncateAddress = (address: string): string => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const getCategoryIcon = (category: string): string => {
        return CATEGORY_ICONS[category.toLowerCase()] || CATEGORY_ICONS.other;
    };

    const toggleRow = (tradeId: string) => {
        setExpandedRow(expandedRow === tradeId ? null : tradeId);
    };

    const handleBookmark = (e: React.MouseEvent, address: string) => {
        e.stopPropagation();
        onBookmarkToggle?.(address);
    };

    // CSV Export function
    const exportToCSV = () => {
        const headers = ['Time', 'Market', 'Category', 'Side', 'Size', 'Price', 'Wallet', 'Score', 'Flagged'];
        const rows = filteredTrades.map(t => [
            new Date(t.timestamp).toISOString(),
            `"${t.marketTitle.replace(/"/g, '""')}"`,
            t.marketCategory,
            t.side,
            t.sizeUsd,
            t.price,
            t.walletAddress,
            t.insiderScore.breakdown.total,
            t.isFlagged ? 'Yes' : 'No',
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `whale-trades-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (filteredTrades.length === 0) {
        return (
            <div className="empty-state">
                <div className="empty-state-icon">🐋</div>
                <p>No whale trades yet. Waiting for activity...</p>
            </div>
        );
    }

    return (
        <div className="whale-tape-container">
            {/* Export Button */}
            <div className="whale-tape-actions">
                <button className="export-btn" onClick={exportToCSV} title="Export to CSV">
                    📥 Export CSV
                </button>
                <span className="trade-count">{filteredTrades.length} trades</span>
            </div>

            <div className="whale-tape-scroll">
                <table className="whale-tape">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Market</th>
                            <th>Side</th>
                            <th>Size</th>
                            <th>Price</th>
                            <th>Wallet</th>
                            <th>Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedTrades.map((trade) => (
                            <>
                                <tr
                                    key={trade.id}
                                    className={`${trade.isFlagged ? 'flagged' : ''} ${expandedRow === trade.id ? 'expanded' : ''}`}
                                    onClick={() => toggleRow(trade.id)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <td className="time-cell">
                                        <span className="relative-time">{formatRelativeTime(trade.timestamp)}</span>
                                    </td>
                                    <td className="market-cell" title={trade.marketTitle}>
                                        <span className="category-icon">{getCategoryIcon(trade.marketCategory)}</span>
                                        <span className="market-title">
                                            {trade.marketTitle.length > 35
                                                ? `${trade.marketTitle.slice(0, 35)}...`
                                                : trade.marketTitle}
                                        </span>
                                    </td>
                                    <td className={trade.side === 'YES' ? 'side-yes' : 'side-no'}>
                                        {trade.side}
                                    </td>
                                    <td className="trade-size">{formatSize(trade.sizeUsd)}</td>
                                    <td className="price-cell">{formatPrice(trade.price)}</td>
                                    <td className="wallet-cell">
                                        <button
                                            className={`bookmark-btn ${bookmarkedWallets.has(trade.walletAddress) ? 'bookmarked' : ''}`}
                                            onClick={(e) => handleBookmark(e, trade.walletAddress)}
                                            title={bookmarkedWallets.has(trade.walletAddress) ? 'Remove bookmark' : 'Bookmark wallet'}
                                        >
                                            {bookmarkedWallets.has(trade.walletAddress) ? '★' : '☆'}
                                        </button>
                                        <a
                                            href={`https://polymarket.com/profile/${trade.proxyWalletAddress || trade.walletAddress}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title="View profile on Polymarket"
                                            onClick={(e) => e.stopPropagation()}
                                            className="wallet-address"
                                        >
                                            {truncateAddress(trade.proxyWalletAddress || trade.walletAddress)}
                                        </a>
                                    </td>
                                    <td>
                                        <ScoreDonut score={trade.insiderScore} size={44} />
                                    </td>
                                </tr>
                                {/* Expanded row showing score breakdown */}
                                {expandedRow === trade.id && (
                                    <tr key={`${trade.id}-expanded`} className="expanded-row">
                                        <td colSpan={7}>
                                            <div className="score-breakdown-grid">
                                                {Object.entries(trade.insiderScore.breakdown)
                                                    .filter(([key]) => key !== 'total')
                                                    .map(([key, value]) => (
                                                        <div key={key} className="breakdown-item">
                                                            <span className="breakdown-label">
                                                                {FACTOR_LABELS[key] || key}
                                                            </span>
                                                            <span className="breakdown-value">+{value}</span>
                                                        </div>
                                                    ))}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="pagination">
                    <button
                        className="pagination-btn"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                    >
                        ← Prev
                    </button>
                    <span className="pagination-info">
                        Page {currentPage} of {totalPages}
                    </span>
                    <button
                        className="pagination-btn"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                    >
                        Next →
                    </button>
                </div>
            )}
        </div>
    );
}
