import { useState, useEffect } from 'react';

interface MetricsSummary {
    totalTrades: number;
    flaggedTrades: number;
    totalWallets: number;
    resolvedMarkets: number;
    flaggedWinRate: number;
    baselineWinRate: number;
    lift: number;
    avgScore: number;
    sampleSize: { flagged: number; baseline: number };
    statisticalSignificance: boolean;
    topFactors: Array<{ name: string; avgContribution: number }>;
}

const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'http://localhost:3001';

export const MetricsPanel: React.FC = () => {
    const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchMetrics();
        // Refresh every 5 minutes
        const interval = setInterval(fetchMetrics, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const fetchMetrics = async () => {
        try {
            const response = await fetch(`${API_URL}/api/metrics/summary`);
            if (!response.ok) {
                throw new Error('Failed to fetch metrics');
            }
            const data = await response.json();
            setMetrics(data);
            setError(null);
        } catch (err) {
            setError('Metrics unavailable (MongoDB not connected)');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="card" style={{ opacity: 0.6 }}>
                <div className="card-header">
                    <h2 className="card-title">📊 Algorithm Validation</h2>
                </div>
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Loading metrics...
                </div>
            </div>
        );
    }

    if (error || !metrics) {
        return (
            <div className="card" style={{ opacity: 0.6 }}>
                <div className="card-header">
                    <h2 className="card-title">📊 Algorithm Validation</h2>
                </div>
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {error || 'No metrics available yet'}
                </div>
            </div>
        );
    }

    const liftPercent = (metrics.lift * 100).toFixed(1);
    const liftPositive = metrics.lift > 0;

    return (
        <div className="card">
            <div className="card-header">
                <h2 className="card-title">📊 Algorithm Validation</h2>
                {metrics.statisticalSignificance && (
                    <span style={{
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.5rem',
                        background: 'var(--accent-success)',
                        borderRadius: '4px',
                        color: 'white'
                    }}>
                        Statistically Significant
                    </span>
                )}
            </div>

            {/* Win Rate Comparison */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-4)',
                padding: 'var(--space-4)',
            }}>
                {/* Flagged Win Rate */}
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        fontSize: '2rem',
                        fontWeight: 'bold',
                        color: 'var(--accent-danger)'
                    }}>
                        {(metrics.flaggedWinRate * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Flagged Win Rate
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        n={metrics.sampleSize.flagged}
                    </div>
                </div>

                {/* Lift */}
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        fontSize: '2rem',
                        fontWeight: 'bold',
                        color: liftPositive ? 'var(--accent-success)' : 'var(--text-muted)'
                    }}>
                        {liftPositive ? '+' : ''}{liftPercent}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Lift vs Baseline
                    </div>
                    <div style={{ fontSize: '0.7rem', color: liftPositive ? 'var(--accent-success)' : 'var(--text-muted)' }}>
                        {liftPositive ? '✓ Algorithm working' : '⚠ Needs more data'}
                    </div>
                </div>

                {/* Baseline Win Rate */}
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        fontSize: '2rem',
                        fontWeight: 'bold',
                        color: 'var(--text-secondary)'
                    }}>
                        {(metrics.baselineWinRate * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Baseline Win Rate
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        n={metrics.sampleSize.baseline}
                    </div>
                </div>
            </div>

            {/* Database Stats */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                borderTop: '1px solid var(--border-color)',
                fontSize: '0.8rem',
            }}>
                <div>
                    <span style={{ color: 'var(--text-muted)' }}>Trades:</span>{' '}
                    <strong>{metrics.totalTrades.toLocaleString()}</strong>
                </div>
                <div>
                    <span style={{ color: 'var(--text-muted)' }}>Flagged:</span>{' '}
                    <strong style={{ color: 'var(--accent-danger)' }}>{metrics.flaggedTrades.toLocaleString()}</strong>
                </div>
                <div>
                    <span style={{ color: 'var(--text-muted)' }}>Wallets:</span>{' '}
                    <strong>{metrics.totalWallets.toLocaleString()}</strong>
                </div>
                <div>
                    <span style={{ color: 'var(--text-muted)' }}>Resolved:</span>{' '}
                    <strong>{metrics.resolvedMarkets}</strong>
                </div>
            </div>

            {/* Top Factors */}
            {metrics.topFactors.length > 0 && (
                <div style={{
                    padding: 'var(--space-3) var(--space-4)',
                    borderTop: '1px solid var(--border-color)',
                }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                        Top Contributing Factors:
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        {metrics.topFactors.slice(0, 5).map((factor, i) => (
                            <span
                                key={factor.name}
                                style={{
                                    padding: '0.25rem 0.5rem',
                                    background: i === 0 ? 'var(--accent-warning)' : 'var(--bg-elevated)',
                                    borderRadius: '4px',
                                    fontSize: '0.75rem',
                                    color: i === 0 ? 'black' : 'var(--text-secondary)',
                                }}
                            >
                                {factor.name}: {factor.avgContribution.toFixed(1)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
