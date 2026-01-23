import { useState, useEffect } from 'react';

interface AdminStats {
    inMemory: {
        totalTrades: number;
        flaggedTrades: number;
        flagRate: string;
        avgScore: string;
        tradesLastHour: number;
    };
    database: {
        tradeCount: number;
        walletCount: number;
    } | null;
    errors?: {
        diversificationErrors: number;
        onChainErrors: number;
        connectionErrors: number;
        clusterErrors: number;
        lastError: string | null;
        lastErrorTime: string | null;
    } | null;
    timestamp: string;
}

interface FlaggedWallet {
    address: string;
    avgScore: string;
    flaggedCount: number;
    totalVolume: string;
    lastTrade: string;
    polymarketUrl: string;
}

interface PnLStatus {
    status: string;
    pendingResolution?: number;
    resolved?: {
        total: number;
        wins: number;
        losses: number;
        winRate: string;
        totalPnl: string;
    };
    message?: string;
}

interface FactorData {
    avg: number;
    max: number;
    count: number;
}

interface FactorBreakdown {
    factors: Record<string, FactorData> | null;
    distribution: Record<string, number> | null;
    totalFlagged: number;
    maxPossibleScore: number;
    message?: string;
}

const FACTOR_LABELS: Record<string, string> = {
    walletAge: 'Wallet Age',
    tradeSize: 'Trade Size',
    timing: 'Timing',
    diversification: 'Diversification',
    onChainSource: 'On-Chain Source',
    specificity: 'Specificity',
    impact: 'Impact',
    connections: 'Connections',
    orderFlow: 'Order Flow',
    cluster: 'Cluster',
};

export function AdminDashboard() {
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [wallets, setWallets] = useState<FlaggedWallet[]>([]);
    const [pnlStatus, setPnlStatus] = useState<PnLStatus | null>(null);
    const [factorBreakdown, setFactorBreakdown] = useState<FactorBreakdown | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [statsRes, walletsRes, pnlRes, factorsRes] = await Promise.all([
                    fetch('/api/admin/stats'),
                    fetch('/api/admin/flagged-wallets?limit=10'),
                    fetch('/api/admin/pnl-status'),
                    fetch('/api/admin/factor-breakdown'),
                ]);

                if (statsRes.ok) setStats(await statsRes.json());
                if (walletsRes.ok) {
                    const data = await walletsRes.json();
                    setWallets(data.wallets || []);
                }
                if (pnlRes.ok) setPnlStatus(await pnlRes.json());
                if (factorsRes.ok) setFactorBreakdown(await factorsRes.json());
            } catch (err) {
                console.error('Failed to fetch admin data:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="admin-dashboard">
                <div className="admin-loading">Loading...</div>
            </div>
        );
    }

    return (
        <div className="admin-dashboard">
            {/* Header */}
            <header className="admin-header">
                <h1>Admin Dashboard</h1>
                <span className="admin-timestamp">
                    {stats?.timestamp ? new Date(stats.timestamp).toLocaleString() : '—'}
                </span>
            </header>

            {/* Stats Cards */}
            <section className="admin-stats-grid">
                <div className="admin-stat-card">
                    <div className="stat-icon">📊</div>
                    <div className="stat-content">
                        <span className="stat-value">{stats?.inMemory.totalTrades ?? '—'}</span>
                        <span className="stat-label">Total Trades</span>
                    </div>
                </div>

                <div className="admin-stat-card flagged">
                    <div className="stat-icon">🚨</div>
                    <div className="stat-content">
                        <span className="stat-value">{stats?.inMemory.flaggedTrades ?? '—'}</span>
                        <span className="stat-label">Flagged ({stats?.inMemory.flagRate})</span>
                    </div>
                </div>

                <div className="admin-stat-card">
                    <div className="stat-icon">📈</div>
                    <div className="stat-content">
                        <span className="stat-value">{stats?.inMemory.avgScore ?? '—'}</span>
                        <span className="stat-label">Avg Score</span>
                    </div>
                </div>

                <div className="admin-stat-card">
                    <div className="stat-icon">⏱️</div>
                    <div className="stat-content">
                        <span className="stat-value">{stats?.inMemory.tradesLastHour ?? '—'}</span>
                        <span className="stat-label">Last Hour</span>
                    </div>
                </div>
            </section>

            {/* Factor Breakdown */}
            <section className="admin-factors-section">
                <h2>Factor Breakdown (Flagged Trades)</h2>
                {!factorBreakdown?.factors ? (
                    <div className="factors-empty">{factorBreakdown?.message || 'No data available'}</div>
                ) : (
                    <div className="factors-grid">
                        {Object.entries(factorBreakdown.factors).map(([key, data]) => (
                            <div key={key} className="factor-row factor-item">
                                <span className="factor-label">{FACTOR_LABELS[key] || key}</span>
                                <div className="factor-bar-container">
                                    <div
                                        className="factor-bar factor-bar-fill"
                                        style={{ width: `${(data.avg / data.max) * 100}%` }}
                                    />
                                    <span className="factor-value">{data.avg.toFixed(1)}/{data.max}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {factorBreakdown?.distribution && (
                    <div className="distribution-row">
                        <span className="distribution-label">Score Distribution:</span>
                        {Object.entries(factorBreakdown.distribution).map(([range, count]) => (
                            <span key={range} className="distribution-badge">
                                {range}: {count}
                            </span>
                        ))}
                    </div>
                )}
            </section>

            {/* Database Stats */}
            {stats?.database && (
                <section className="admin-db-stats">
                    <h2>Database</h2>
                    <div className="db-stats-row">
                        <span>{stats.database.tradeCount.toLocaleString()} trades</span>
                        <span className="separator">•</span>
                        <span>{stats.database.walletCount.toLocaleString()} wallets</span>
                    </div>
                </section>
            )}

            {/* Error Stats (Only if errors exist) */}
            {stats?.errors && (
                (stats.errors.diversificationErrors > 0 ||
                    stats.errors.onChainErrors > 0 ||
                    stats.errors.connectionErrors > 0 ||
                    stats.errors.clusterErrors > 0) && (
                    <section className="admin-errors-section">
                        <h2>System Health</h2>
                        <div className="errors-grid">
                            <div className="error-item">
                                <span className="error-count">{stats.errors.diversificationErrors}</span>
                                <span className="error-label">Diversification</span>
                            </div>
                            <div className="error-item">
                                <span className="error-count">{stats.errors.onChainErrors}</span>
                                <span className="error-label">On-Chain</span>
                            </div>
                            <div className="error-item">
                                <span className="error-count">{stats.errors.connectionErrors}</span>
                                <span className="error-label">Connections</span>
                            </div>
                            <div className="error-item">
                                <span className="error-count">{stats.errors.clusterErrors}</span>
                                <span className="error-label">Cluster</span>
                            </div>
                        </div>
                        {stats.errors.lastError && (
                            <div className="last-error">
                                <strong>Last Error:</strong> {stats.errors.lastError}
                                <span className="error-time">
                                    ({new Date(stats.errors.lastErrorTime!).toLocaleTimeString()})
                                </span>
                            </div>
                        )}
                    </section>
                ))}

            {/* PnL Status */}
            <section className="admin-pnl-section">
                <h2>PnL Tracking</h2>
                {pnlStatus?.status === 'disabled' ? (
                    <div className="pnl-disabled">{pnlStatus.message}</div>
                ) : (
                    <div className="pnl-stats-row">
                        <div className="pnl-stat">
                            <span className="pnl-value">{pnlStatus?.pendingResolution ?? '—'}</span>
                            <span className="pnl-label">Pending</span>
                        </div>
                        <div className="pnl-stat">
                            <span className="pnl-value">{pnlStatus?.resolved?.winRate ?? '—'}</span>
                            <span className="pnl-label">Win Rate</span>
                        </div>
                        <div className="pnl-stat">
                            <span className="pnl-value">{pnlStatus?.resolved?.totalPnl ?? '—'}</span>
                            <span className="pnl-label">Total PnL</span>
                        </div>
                    </div>
                )}
            </section>

            {/* Flagged Wallets */}
            <section className="admin-wallets-section">
                <h2>Top Flagged Wallets</h2>
                {wallets.length === 0 ? (
                    <div className="wallets-empty">No flagged wallets yet</div>
                ) : (
                    <div className="wallets-table">
                        <div className="wallets-header">
                            <span>Address</span>
                            <span>Score</span>
                            <span>Flags</span>
                            <span>Volume</span>
                        </div>
                        {wallets.map((wallet) => (
                            <a
                                key={wallet.address}
                                href={wallet.polymarketUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="wallet-row"
                            >
                                <span className="wallet-address">
                                    {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                                </span>
                                <span className="wallet-score">{wallet.avgScore}</span>
                                <span className="wallet-flags">{wallet.flaggedCount}</span>
                                <span className="wallet-volume">{wallet.totalVolume}</span>
                            </a>
                        ))}
                    </div>
                )}
            </section>

            {/* Back link */}
            <footer className="admin-footer">
                <a href="/" className="back-link">← Back to Dashboard</a>
            </footer>
        </div>
    );
}
