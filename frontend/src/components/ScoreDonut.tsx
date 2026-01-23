import { InsiderScore, ScoreBreakdown } from '../types';

interface ScoreDonutProps {
    score: InsiderScore;
    size?: number;
}

// Colors for each scoring factor
const FACTOR_COLORS: Record<keyof Omit<ScoreBreakdown, 'total'>, string> = {
    walletAge: '#ef4444',      // Red
    tradeSize: '#f97316',      // Orange
    timing: '#eab308',         // Yellow
    diversification: '#22c55e', // Green
    onChainSource: '#06b6d4',  // Cyan
    specificity: '#8b5cf6',    // Purple
    impact: '#ec4899',         // Pink
    connections: '#6366f1',    // Indigo
    orderFlow: '#14b8a6',      // Teal
    cluster: '#f43f5e',        // Rose
    velocity: '#a855f7',       // Violet
    proximity: '#0891b2',      // Cyan-dark
};

const FACTOR_LABELS: Record<keyof Omit<ScoreBreakdown, 'total'>, string> = {
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
    velocity: 'Velocity',
    proximity: 'Proximity',
};

export function ScoreDonut({ score, size = 60 }: ScoreDonutProps) {
    const breakdown = score.breakdown;
    const total = breakdown.total;

    // Calculate segments
    const segments: { key: string; value: number; color: string; label: string }[] = [];
    const factorKeys = Object.keys(FACTOR_COLORS) as Array<keyof Omit<ScoreBreakdown, 'total'>>;

    for (const key of factorKeys) {
        const value = breakdown[key];
        if (value > 0) {
            segments.push({
                key,
                value,
                color: FACTOR_COLORS[key],
                label: FACTOR_LABELS[key],
            });
        }
    }

    // Sort by value descending
    segments.sort((a, b) => b.value - a.value);

    // SVG donut chart
    const radius = size / 2 - 4;
    const totalValue = segments.reduce((sum, s) => sum + s.value, 0);

    let currentAngle = 0;
    const paths = segments.map((segment) => {
        const angle = (segment.value / (totalValue || 1)) * 360;
        const path = describeArc(size / 2, size / 2, radius, currentAngle, currentAngle + angle);
        currentAngle += angle;
        return { ...segment, path };
    });

    // Get color based on total score
    const getScoreColor = (score: number): string => {
        if (score >= 80) return '#ef4444';  // High - red
        if (score >= 65) return '#f97316';  // Medium - orange
        if (score >= 50) return '#eab308';  // Low-medium - yellow
        return '#6b7280';                    // Low - gray
    };

    return (
        <div className="score-donut-container">
            <svg width={size} height={size} className="score-donut">
                {/* Background circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="#374151"
                    strokeWidth="6"
                />

                {/* Colored segments */}
                {paths.map((segment) => (
                    <path
                        key={segment.key}
                        d={segment.path}
                        fill="none"
                        stroke={segment.color}
                        strokeWidth="6"
                        strokeLinecap="round"
                        className="donut-segment"
                    />
                ))}

                {/* Center score */}
                <text
                    x={size / 2}
                    y={size / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={getScoreColor(total)}
                    fontSize={size / 3.5}
                    fontWeight="bold"
                    className="score-text"
                >
                    {total}
                </text>
            </svg>

            {/* Hover tooltip with breakdown */}
            <div className="score-tooltip">
                <div className="score-tooltip-header">
                    Score Breakdown ({total}/100)
                </div>
                <div className="score-tooltip-grid">
                    {segments.slice(0, 6).map((segment) => (
                        <div key={segment.key} className="score-tooltip-item">
                            <span
                                className="score-tooltip-dot"
                                style={{ backgroundColor: segment.color }}
                            />
                            <span className="score-tooltip-label">{segment.label}</span>
                            <span className="score-tooltip-value">+{segment.value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Helper function to create SVG arc path
function describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number): string {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
        'M', start.x, start.y,
        'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y
    ].join(' ');
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
    return {
        x: centerX + (radius * Math.cos(angleInRadians)),
        y: centerY + (radius * Math.sin(angleInRadians))
    };
}
