import { useState, useEffect, useCallback } from 'react';
import { LeaderboardEntry } from '../types';

interface PnLLeaderboardProps {
    limit?: number;
}

const MEDAL_ICONS = ['🥇', '🥈', '🥉'];

export function PnLLeaderboard({ limit = 20 }: PnLLeaderboardProps) {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<'roi' | 'pnl' | 'winRate'>('roi');
    const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
    const [walletStats, setWalletStats] = useState<LeaderboardEntry | null>(null);

    // Fetch leaderboard
    const fetchLeaderboard = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/metrics/leaderboard?limit=${limit}`);
            const data = await res.json();
            if (data.success) {
                setEntries(data.entries || []);
            } else {
                setError(data.error || 'Failed to load leaderboard');
            }
        } catch (err) {
            setError('Failed to connect to server');
        } finally {
            setIsLoading(false);
        }
    }, [limit]);

    // Fetch individual wallet stats
    const fetchWalletStats = async (address: string) => {
        try {
            const res = await fetch(`/api/metrics/leaderboard/${address}`);
            const data = await res.json();
            if (data.success) {
                setWalletStats(data.stats);
                setSelectedWallet(address);
            }
        } catch (err) {
            console.error('Failed to fetch wallet stats');
        }
    };

    useEffect(() => {
        fetchLeaderboard();
    }, [fetchLeaderboard]);

    // Sort entries
    const sortedEntries = [...entries].sort((a, b) => {
        switch (sortBy) {
            case 'pnl': return b.totalPnl - a.totalPnl;
            case 'winRate': return b.winRate - a.winRate;
            default: return b.roi - a.roi;
        }
    });

    const formatMoney = (n: number, showSign = false) => {
        const sign = showSign && n > 0 ? '+' : '';
        if (Math.abs(n) >= 1000000) return `${sign}$${(n / 1000000).toFixed(1)}M`;
        if (Math.abs(n) >= 1000) return `${sign}$${(n / 1000).toFixed(1)}K`;
        return `${sign}$${n.toFixed(0)}`;
    };

    const formatPercent = (n: number) => {
        const sign = n > 0 ? '+' : '';
        return `${sign}${n.toFixed(1)}%`;
    };

    const truncateAddress = (address: string) =>
        `${address.slice(0, 6)}...${address.slice(-4)}`;

    const formatRelativeTime = (dateStr: string) => {
        const now = new Date();
        const date = new Date(dateStr);
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const getROIClass = (roi: number) => {
        if (roi >= 100) return 'roi--excellent';
        if (roi >= 50) return 'roi--great';
        if (roi >= 0) return 'roi--good';
        return 'roi--negative';
    };

    const getWinRateClass = (rate: number) => {
        if (rate >= 70) return 'wr--excellent';
        if (rate >= 55) return 'wr--good';
        return 'wr--average';
    };

    return (
        <div className="leaderboard">
            {/* Header */}
            <div className="leaderboard__header">
                <div className="leaderboard__title">
                    <span className="leaderboard__icon">🏆</span>
                    <h2>PnL Leaderboard</h2>
                </div>
                <div className="leaderboard__controls">
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as 'roi' | 'pnl' | 'winRate')}
                        className="sort-select"
                    >
                        <option value="roi">Sort by ROI</option>
                        <option value="pnl">Sort by PnL</option>
                        <option value="winRate">Sort by Win Rate</option>
                    </select>
                    <button
                        className="btn btn--ghost btn--sm"
                        onClick={fetchLeaderboard}
                        title="Refresh"
                    >
                        ↻
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="leaderboard__error">
                    <span>⚠️ {error}</span>
                </div>
            )}

            {/* Loading State */}
            {isLoading ? (
                <div className="leaderboard__loading">
                    <div className="spinner" />
                    <span>Loading leaderboard...</span>
                </div>
            ) : entries.length === 0 ? (
                <div className="leaderboard__empty">
                    <span className="empty-icon">📊</span>
                    <p>No resolved trades yet. Check back after markets settle!</p>
                </div>
            ) : (
                <div className="leaderboard__table-wrapper">
                    <table className="leaderboard__table">
                        <thead>
                            <tr>
                                <th className="col-rank">#</th>
                                <th className="col-wallet">Wallet</th>
                                <th className="col-trades">Trades</th>
                                <th className="col-record">W/L</th>
                                <th className="col-winrate">Win%</th>
                                <th className="col-pnl">PnL</th>
                                <th className="col-roi">ROI</th>
                                <th className="col-last">Last Trade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedEntries.map((entry, idx) => (
                                <tr
                                    key={entry.walletAddress}
                                    className={`leaderboard__row ${selectedWallet === entry.walletAddress ? 'leaderboard__row--selected' : ''}`}
                                    onClick={() => fetchWalletStats(entry.walletAddress)}
                                >
                                    <td className="col-rank">
                                        {idx < 3 ? (
                                            <span className="medal">{MEDAL_ICONS[idx]}</span>
                                        ) : (
                                            <span className="rank-num">{idx + 1}</span>
                                        )}
                                    </td>
                                    <td className="col-wallet">
                                        <a
                                            href={`https://polymarket.com/profile/${entry.walletAddress}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            className="wallet-link"
                                        >
                                            {truncateAddress(entry.walletAddress)}
                                        </a>
                                    </td>
                                    <td className="col-trades">
                                        <span className="trades-count">{entry.totalTrades}</span>
                                    </td>
                                    <td className="col-record">
                                        <span className="wins">{entry.wins}</span>
                                        <span className="separator">/</span>
                                        <span className="losses">{entry.losses}</span>
                                    </td>
                                    <td className="col-winrate">
                                        <div className="winrate-cell">
                                            <span className={`winrate-value ${getWinRateClass(entry.winRate)}`}>
                                                {entry.winRate.toFixed(0)}%
                                            </span>
                                            <div className="winrate-bar">
                                                <div
                                                    className="winrate-bar__fill"
                                                    style={{ width: `${Math.min(100, entry.winRate)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="col-pnl">
                                        <span className={`pnl-value ${entry.totalPnl >= 0 ? 'pnl--positive' : 'pnl--negative'}`}>
                                            {formatMoney(entry.totalPnl, true)}
                                        </span>
                                    </td>
                                    <td className="col-roi">
                                        <span className={`roi-value ${getROIClass(entry.roi)}`}>
                                            {formatPercent(entry.roi)}
                                        </span>
                                    </td>
                                    <td className="col-last">
                                        <span className="last-trade">
                                            {formatRelativeTime(entry.lastTradeDate)}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Wallet Detail Modal */}
            {selectedWallet && walletStats && (
                <div className="wallet-modal-overlay" onClick={() => setSelectedWallet(null)}>
                    <div className="wallet-modal" onClick={e => e.stopPropagation()}>
                        <div className="wallet-modal__header">
                            <h3>Wallet Stats</h3>
                            <button className="btn btn--ghost btn--sm" onClick={() => setSelectedWallet(null)}>✕</button>
                        </div>
                        <div className="wallet-modal__content">
                            <div className="wallet-modal__address">
                                <a
                                    href={`https://polymarket.com/profile/${selectedWallet}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {selectedWallet}
                                </a>
                            </div>
                            <div className="wallet-modal__stats">
                                <div className="modal-stat">
                                    <span className="modal-stat__value">{walletStats.totalTrades}</span>
                                    <span className="modal-stat__label">Total Trades</span>
                                </div>
                                <div className="modal-stat">
                                    <span className="modal-stat__value">{walletStats.wins} / {walletStats.losses}</span>
                                    <span className="modal-stat__label">Win / Loss</span>
                                </div>
                                <div className="modal-stat">
                                    <span className={`modal-stat__value ${getWinRateClass(walletStats.winRate)}`}>
                                        {walletStats.winRate.toFixed(1)}%
                                    </span>
                                    <span className="modal-stat__label">Win Rate</span>
                                </div>
                                <div className="modal-stat">
                                    <span className={`modal-stat__value ${walletStats.totalPnl >= 0 ? 'pnl--positive' : 'pnl--negative'}`}>
                                        {formatMoney(walletStats.totalPnl, true)}
                                    </span>
                                    <span className="modal-stat__label">Total PnL</span>
                                </div>
                                <div className="modal-stat">
                                    <span className={`modal-stat__value ${getROIClass(walletStats.roi)}`}>
                                        {formatPercent(walletStats.roi)}
                                    </span>
                                    <span className="modal-stat__label">ROI</span>
                                </div>
                                <div className="modal-stat">
                                    <span className="modal-stat__value">
                                        {formatMoney(walletStats.avgTradeSize)}
                                    </span>
                                    <span className="modal-stat__label">Avg Trade</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
