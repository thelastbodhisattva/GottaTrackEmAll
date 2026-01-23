import { useState, useMemo, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { WhaleTape } from './components/WhaleTape';
import { EthicsToggle } from './components/EthicsToggle';
import { FiltersBar } from './components/FiltersBar';
import { StatsGrid } from './components/StatsGrid';
import { HansonQuoteCard } from './components/HansonQuoteCard';
import { MetricsPanel } from './components/MetricsPanel';
import { AdminDashboard } from './components/AdminDashboard';
import { ErrorBoundary, TradeErrorFallback } from './components/ErrorBoundary';
import { ThemeToggle } from './components/ThemeToggle';
import { MarketCategory, ViewMode, EnrichedTrade } from './types';

function App() {
    // Check if on admin route
    const isAdminRoute = window.location.pathname === '/admin';

    if (isAdminRoute) {
        return (
            <ErrorBoundary>
                <AdminDashboard />
            </ErrorBoundary>
        );
    }

    // WebSocket connection for real-time trades
    const { trades: wsTrades, isConnected } = useWebSocket(100);
    const [historyTrades, setHistoryTrades] = useState<EnrichedTrade[]>([]);

    // Combine history and realtime trades
    const trades = useMemo(() => {
        // Create map by ID to deduplicate
        const tradeMap = new Map();
        [...historyTrades, ...wsTrades].forEach(t => tradeMap.set(t.id, t));
        return Array.from(tradeMap.values()).sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    }, [historyTrades, wsTrades]);

    // Loading state
    const [isLoading, setIsLoading] = useState(true);

    // Fetch history on mount
    useEffect(() => {
        const fetchTrades = async () => {
            setIsLoading(true);
            try {
                const res = await fetch('/api/trades?limit=100');
                const data = await res.json();
                if (data.data) {
                    setHistoryTrades(data.data);
                }
            } catch (err) {
                console.error('Failed to fetch history:', err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchTrades();
    }, []);

    // UI State
    const [viewMode, setViewMode] = useState<ViewMode>('neutral');
    const [categoryFilter, setCategoryFilter] = useState<MarketCategory | 'all'>('all');
    const [flaggedOnly, setFlaggedOnly] = useState(false);
    const [minSize, setMinSize] = useState(1000);

    // Bookmarked wallets (persisted in localStorage)
    const [bookmarkedWallets, setBookmarkedWallets] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('bookmarkedWallets');
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });

    const toggleBookmark = (address: string) => {
        setBookmarkedWallets(prev => {
            const next = new Set(prev);
            if (next.has(address)) {
                next.delete(address);
            } else {
                next.add(address);
            }
            localStorage.setItem('bookmarkedWallets', JSON.stringify([...next]));
            return next;
        });
    };

    // Calculate stats from trades
    const stats = useMemo(() => {
        const filtered = trades.filter(t => t.sizeUsd >= minSize);
        return {
            totalTrades: filtered.length,
            flaggedTrades: filtered.filter(t => t.isFlagged).length,
            totalVolume: filtered.reduce((sum, t) => sum + t.sizeUsd, 0),
            trackedWallets: new Set(filtered.map(t => t.walletAddress)).size,
        };
    }, [trades, minSize]);

    // Filter trades by min size
    const filteredTrades = useMemo(() => {
        return trades.filter(t => t.sizeUsd >= minSize);
    }, [trades, minSize]);

    const showEthics = viewMode === 'efficiency';

    return (
        <div className="app-container">
            {/* Header */}
            <header className="app-header">
                <div className="app-logo">
                    <span className="app-logo-icon">🐋</span>
                    <span>Polymarket Whale Tracker</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <ThemeToggle />
                    <EthicsToggle mode={viewMode} onChange={setViewMode} />

                    <div className="connection-status">
                        <div className={`connection-dot ${isConnected ? 'connected' : 'disconnected'}`} />
                        <span>{isConnected ? 'Live' : 'Connecting...'}</span>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="app-main">
                {/* Stats Overview */}
                <StatsGrid {...stats} />

                {/* Algorithm Validation Metrics */}
                <MetricsPanel />

                {/* Filters */}
                <FiltersBar
                    category={categoryFilter}
                    onCategoryChange={setCategoryFilter}
                    flaggedOnly={flaggedOnly}
                    onFlaggedOnlyChange={setFlaggedOnly}
                    minSize={minSize}
                    onMinSizeChange={setMinSize}
                />

                {/* Whale Tape Card */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title">
                            🐋 Whale Tape
                            {flaggedOnly && <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem', color: 'var(--accent-danger)' }}>🚨 Signals Only</span>}
                        </h2>
                    </div>

                    <ErrorBoundary fallback={<TradeErrorFallback />}>
                        {isLoading ? (
                            <div className="skeleton-container">
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <div key={i} className="skeleton skeleton-row" />
                                ))}
                            </div>
                        ) : (
                            <WhaleTape
                                trades={filteredTrades}
                                categoryFilter={categoryFilter}
                                flaggedOnly={flaggedOnly}
                                bookmarkedWallets={bookmarkedWallets}
                                onBookmarkToggle={toggleBookmark}
                            />
                        )}
                    </ErrorBoundary>
                </div>

                {/* Hanson Quote (shown in Efficiency View) */}
                {showEthics && <HansonQuoteCard />}
            </main>

            {/* Footer */}
            <footer style={{
                padding: 'var(--space-4) var(--space-6)',
                textAlign: 'center',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
            }}>
                <p>
                    Polymarket Whale Tracker with Insider Detection •
                    <span style={{ marginLeft: '0.5rem' }}>
                        Non-custodial • Privacy-focused • Educational purposes only
                    </span>
                </p>
                <a
                    href="/admin"
                    style={{
                        color: 'var(--text-muted)',
                        textDecoration: 'none',
                        transition: 'color 0.2s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent-primary)'}
                    onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                    Admin →
                </a>
            </footer>
        </div>
    );
}

export default App;
