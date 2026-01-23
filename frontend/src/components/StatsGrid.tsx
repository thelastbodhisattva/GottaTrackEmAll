interface StatsGridProps {
    totalTrades: number;
    flaggedTrades: number;
    totalVolume: number;
    trackedWallets: number;
}

export function StatsGrid({
    totalTrades,
    flaggedTrades,
    totalVolume,
    trackedWallets,
}: StatsGridProps) {
    const formatVolume = (vol: number): string => {
        if (vol >= 1000000) {
            return `$${(vol / 1000000).toFixed(2)}M`;
        }
        if (vol >= 1000) {
            return `$${(vol / 1000).toFixed(1)}K`;
        }
        return `$${vol.toFixed(0)}`;
    };

    return (
        <div className="stats-grid">
            <div className="stat-card">
                <div className="stat-card-icon">🐋</div>
                <div className="stat-card-value">{totalTrades.toLocaleString()}</div>
                <div className="stat-card-label">Total Trades</div>
            </div>

            <div className="stat-card">
                <div className="stat-card-icon">🚨</div>
                <div className="stat-card-value">{flaggedTrades.toLocaleString()}</div>
                <div className="stat-card-label">Insider Signals</div>
            </div>

            <div className="stat-card">
                <div className="stat-card-icon">💰</div>
                <div className="stat-card-value">{formatVolume(totalVolume)}</div>
                <div className="stat-card-label">Total Volume</div>
            </div>

            <div className="stat-card">
                <div className="stat-card-icon">👛</div>
                <div className="stat-card-value">{trackedWallets.toLocaleString()}</div>
                <div className="stat-card-label">Tracked Wallets</div>
            </div>
        </div>
    );
}
