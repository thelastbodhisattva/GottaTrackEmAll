import { useState, useEffect, useCallback } from 'react';
import { SubscriptionHealth } from '../types';

interface WebSocketPanelProps {
    className?: string;
}

export function WebSocketPanel({ className = '' }: WebSocketPanelProps) {
    const [subscriptions, setSubscriptions] = useState<string[]>([]);
    const [health, setHealth] = useState<SubscriptionHealth | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Fetch current subscriptions
    const fetchSubscriptions = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/subscriptions');
            const data = await res.json();
            if (data.success) {
                setSubscriptions(data.subscribedMarkets || []);
            }
        } catch (err) {
            setError('Failed to fetch subscriptions');
        }
    }, []);

    // Fetch health stats
    const fetchHealth = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/subscriptions/health');
            const data = await res.json();
            if (data.success) {
                setHealth(data.health);
            }
        } catch (err) {
            console.error('Failed to fetch health');
        }
    }, []);

    // Initial load
    useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            await Promise.all([fetchSubscriptions(), fetchHealth()]);
            setIsLoading(false);
        };
        load();
    }, [fetchSubscriptions, fetchHealth]);

    // Auto-refresh health every 30s
    useEffect(() => {
        const interval = setInterval(fetchHealth, 30000);
        return () => clearInterval(interval);
    }, [fetchHealth]);

    // Refresh subscriptions
    const handleRefresh = async () => {
        setIsRefreshing(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/subscriptions/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await res.json();
            if (data.success) {
                await fetchSubscriptions();
                await fetchHealth();
            } else {
                setError(data.error || 'Refresh failed');
            }
        } catch (err) {
            setError('Failed to refresh subscriptions');
        } finally {
            setIsRefreshing(false);
        }
    };

    const formatUptime = (ms: number) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const formatTime = (dateStr: string | null) => {
        if (!dateStr) return 'Never';
        const date = new Date(dateStr);
        const now = new Date();
        const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (diffSecs < 60) return `${diffSecs}s ago`;
        if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`ws-panel ${className}`}>
            {/* Header */}
            <div className="ws-panel__header">
                <div className="ws-panel__title">
                    <span className="ws-panel__icon">📡</span>
                    <h3>WebSocket Subscriptions</h3>
                </div>
                <button
                    className={`btn btn--primary btn--sm ${isRefreshing ? 'btn--loading' : ''}`}
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                >
                    {isRefreshing ? (
                        <>
                            <span className="spinner spinner--sm" />
                            Refreshing...
                        </>
                    ) : (
                        '↻ Refresh'
                    )}
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="ws-panel__error">
                    <span>⚠️ {error}</span>
                    <button onClick={() => setError(null)}>×</button>
                </div>
            )}

            {/* Health Stats */}
            {health && (
                <div className="ws-panel__health">
                    <div className="health-stat">
                        <span className={`health-indicator ${health.isConnected ? 'health-indicator--connected' : 'health-indicator--disconnected'}`}>
                            ●
                        </span>
                        <span className="health-label">
                            {health.isConnected ? 'Connected' : 'Disconnected'}
                        </span>
                    </div>
                    <div className="health-stat">
                        <span className="health-value">{health.subscribedCount}</span>
                        <span className="health-label">Markets</span>
                    </div>
                    <div className="health-stat">
                        <span className="health-value">{formatTime(health.lastMessageAt)}</span>
                        <span className="health-label">Last Message</span>
                    </div>
                    <div className="health-stat">
                        <span className="health-value">{formatUptime(health.uptime)}</span>
                        <span className="health-label">Uptime</span>
                    </div>
                    <div className="health-stat">
                        <span className="health-value">{health.reconnectCount}</span>
                        <span className="health-label">Reconnects</span>
                    </div>
                </div>
            )}

            {/* Subscriptions List */}
            {isLoading ? (
                <div className="ws-panel__loading">
                    <div className="spinner" />
                    <span>Loading...</span>
                </div>
            ) : subscriptions.length === 0 ? (
                <div className="ws-panel__empty">
                    <span className="empty-icon">📭</span>
                    <p>No active subscriptions</p>
                </div>
            ) : (
                <div className="ws-panel__subscriptions">
                    <div className="subscriptions-header">
                        <span>Subscribed Markets ({subscriptions.length})</span>
                    </div>
                    <div className="subscriptions-list">
                        {subscriptions.slice(0, 20).map((marketId, idx) => (
                            <div key={marketId} className="subscription-item">
                                <span className="subscription-index">{idx + 1}</span>
                                <span className="subscription-id" title={marketId}>
                                    {marketId.slice(0, 8)}...{marketId.slice(-6)}
                                </span>
                            </div>
                        ))}
                        {subscriptions.length > 20 && (
                            <div className="subscriptions-more">
                                +{subscriptions.length - 20} more markets
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
