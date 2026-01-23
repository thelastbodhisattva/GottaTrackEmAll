import { motion } from 'framer-motion';

interface StatsGridProps {
    totalTrades: number;
    flaggedTrades: number;
    totalVolume: number;
    trackedWallets: number;
}

// Staggered reveal animation variants
const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.1,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
            type: 'spring' as const,
            stiffness: 400,
            damping: 25,
        },
    },
};

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

    const stats = [
        { icon: '🐋', value: totalTrades.toLocaleString(), label: 'Total Trades' },
        { icon: '🚨', value: flaggedTrades.toLocaleString(), label: 'Insider Signals' },
        { icon: '💰', value: formatVolume(totalVolume), label: 'Total Volume' },
        { icon: '👛', value: trackedWallets.toLocaleString(), label: 'Tracked Wallets' },
    ];

    return (
        <motion.div
            className="stats-grid"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
        >
            {stats.map((stat) => (
                <motion.div
                    key={stat.label}
                    className="stat-card"
                    variants={itemVariants}
                    whileHover={{
                        scale: 1.02,
                        y: -4,
                        transition: { type: 'spring', stiffness: 400, damping: 17 }
                    }}
                >
                    <div className="stat-card-icon">{stat.icon}</div>
                    <div className="stat-card-value">{stat.value}</div>
                    <div className="stat-card-label">{stat.label}</div>
                </motion.div>
            ))}
        </motion.div>
    );
}

