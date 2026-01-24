import React, { useState, useEffect, useCallback } from 'react';
import { Watchlist, MarketCategory } from '../types';

interface WatchlistManagerProps {
    onClose?: () => void;
}

const CATEGORY_OPTIONS: MarketCategory[] = [
    'geopolitics', 'war', 'crypto', 'sports', 'esports',
    'popculture', 'entertainment', 'science', 'other'
];

const CATEGORY_LABELS: Record<MarketCategory, string> = {
    geopolitics: '🏛️ Geopolitics',
    war: '⚔️ War',
    crypto: '💰 Crypto',
    sports: '⚽ Sports',
    esports: '🎮 Esports',
    popculture: '⭐ Pop Culture',
    entertainment: '🎬 Entertainment',
    science: '🔬 Science',
    other: '🌍 Other',
};

export function WatchlistManager({ onClose }: WatchlistManagerProps) {
    const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);

    // Form state
    const [formName, setFormName] = useState('');
    const [formWallets, setFormWallets] = useState('');
    const [formMinSize, setFormMinSize] = useState(100000);
    const [formMinScore, setFormMinScore] = useState(50);
    const [formCategories, setFormCategories] = useState<MarketCategory[]>([]);
    const [formIsActive, setFormIsActive] = useState(true);

    // Fetch watchlists
    const fetchWatchlists = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/watchlists');
            const data = await res.json();
            if (data.success) {
                setWatchlists(data.data);
            }
        } catch (err) {
            setError('Failed to load watchlists');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchWatchlists();
    }, [fetchWatchlists]);

    // Create watchlist
    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        const walletArray = formWallets
            .split(/[,\n]/)
            .map(w => w.trim().toLowerCase())
            .filter(w => /^0x[a-f0-9]{40}$/i.test(w));

        try {
            const res = await fetch('/api/watchlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formName,
                    wallets: walletArray,
                    alertConfig: {
                        minTradeSize: formMinSize,
                        minScore: formMinScore,
                        categories: formCategories,
                        channels: [],
                    },
                    isActive: formIsActive,
                }),
            });
            if (res.ok) {
                resetForm();
                setShowCreateForm(false);
                fetchWatchlists();
            }
        } catch (err) {
            setError('Failed to create watchlist');
        }
    };

    // Update watchlist
    const handleUpdate = async (id: string) => {
        const walletArray = formWallets
            .split(/[,\n]/)
            .map(w => w.trim().toLowerCase())
            .filter(w => /^0x[a-f0-9]{40}$/i.test(w));

        try {
            const res = await fetch(`/api/watchlists/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formName,
                    wallets: walletArray,
                    alertConfig: {
                        minTradeSize: formMinSize,
                        minScore: formMinScore,
                        categories: formCategories,
                        channels: [],
                    },
                    isActive: formIsActive,
                }),
            });
            if (res.ok) {
                resetForm();
                setEditingId(null);
                fetchWatchlists();
            }
        } catch (err) {
            setError('Failed to update watchlist');
        }
    };

    // Delete watchlist
    const handleDelete = async (id: string) => {
        if (!confirm('Delete this watchlist?')) return;
        try {
            await fetch(`/api/watchlists/${id}`, { method: 'DELETE' });
            fetchWatchlists();
        } catch (err) {
            setError('Failed to delete watchlist');
        }
    };

    // Toggle active status
    const toggleActive = async (watchlist: Watchlist) => {
        try {
            await fetch(`/api/watchlists/${watchlist._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !watchlist.isActive }),
            });
            fetchWatchlists();
        } catch (err) {
            setError('Failed to toggle status');
        }
    };

    // Edit mode
    const startEdit = (watchlist: Watchlist) => {
        setEditingId(watchlist._id);
        setFormName(watchlist.name);
        setFormWallets(watchlist.wallets.join('\n'));
        setFormMinSize(watchlist.alertConfig.minTradeSize);
        setFormMinScore(watchlist.alertConfig.minScore);
        setFormCategories(watchlist.alertConfig.categories);
        setFormIsActive(watchlist.isActive);
    };

    const resetForm = () => {
        setFormName('');
        setFormWallets('');
        setFormMinSize(100000);
        setFormMinScore(50);
        setFormCategories([]);
        setFormIsActive(true);
    };

    const toggleCategory = (cat: MarketCategory) => {
        setFormCategories(prev =>
            prev.includes(cat)
                ? prev.filter(c => c !== cat)
                : [...prev, cat]
        );
    };

    const formatMoney = (n: number) => {
        if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
        return `$${n}`;
    };

    return (
        <div className="watchlist-manager">
            {/* Header */}
            <div className="watchlist-manager__header">
                <div className="watchlist-manager__title">
                    <span className="watchlist-manager__icon">👁️</span>
                    <h2>Whale Watchlists</h2>
                </div>
                <div className="watchlist-manager__actions">
                    <button
                        className="btn btn--primary btn--sm"
                        onClick={() => setShowCreateForm(true)}
                    >
                        <span>+ New Watchlist</span>
                    </button>
                    {onClose && (
                        <button className="btn btn--ghost btn--sm" onClick={onClose}>
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="watchlist-manager__error">
                    <span>⚠️ {error}</span>
                    <button onClick={() => setError(null)}>×</button>
                </div>
            )}

            {/* Create/Edit Form */}
            {(showCreateForm || editingId) && (
                <form
                    className="watchlist-form"
                    onSubmit={editingId ? (e) => { e.preventDefault(); handleUpdate(editingId); } : handleCreate}
                >
                    <div className="watchlist-form__row">
                        <label>
                            <span className="label-text">Name</span>
                            <input
                                type="text"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                placeholder="Top Whales"
                                required
                            />
                        </label>
                    </div>

                    <div className="watchlist-form__row">
                        <label>
                            <span className="label-text">Wallet Addresses (one per line)</span>
                            <textarea
                                value={formWallets}
                                onChange={e => setFormWallets(e.target.value)}
                                placeholder="0x1234...abcd&#10;0x5678...efgh"
                                rows={4}
                            />
                        </label>
                    </div>

                    <div className="watchlist-form__grid">
                        <label>
                            <span className="label-text">Min Trade Size</span>
                            <input
                                type="number"
                                value={formMinSize}
                                onChange={e => setFormMinSize(Number(e.target.value))}
                                min={0}
                                step={10000}
                            />
                        </label>
                        <label>
                            <span className="label-text">Min Score</span>
                            <input
                                type="number"
                                value={formMinScore}
                                onChange={e => setFormMinScore(Number(e.target.value))}
                                min={0}
                                max={100}
                            />
                        </label>
                    </div>

                    <div className="watchlist-form__row">
                        <span className="label-text">Categories</span>
                        <div className="watchlist-form__categories">
                            {CATEGORY_OPTIONS.map(cat => (
                                <button
                                    key={cat}
                                    type="button"
                                    className={`category-chip ${formCategories.includes(cat) ? 'category-chip--active' : ''}`}
                                    onClick={() => toggleCategory(cat)}
                                >
                                    {CATEGORY_LABELS[cat]}
                                </button>
                            ))}
                        </div>
                        <small className="hint">Leave empty for all categories</small>
                    </div>

                    <div className="watchlist-form__row">
                        <label className="toggle-label">
                            <input
                                type="checkbox"
                                checked={formIsActive}
                                onChange={e => setFormIsActive(e.target.checked)}
                            />
                            <span>Active</span>
                        </label>
                    </div>

                    <div className="watchlist-form__actions">
                        <button type="submit" className="btn btn--primary">
                            {editingId ? 'Update' : 'Create'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => {
                                resetForm();
                                setShowCreateForm(false);
                                setEditingId(null);
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            {/* Watchlist Cards */}
            {isLoading ? (
                <div className="watchlist-manager__loading">
                    <div className="spinner" />
                    <span>Loading watchlists...</span>
                </div>
            ) : watchlists.length === 0 ? (
                <div className="watchlist-manager__empty">
                    <span className="empty-icon">📋</span>
                    <p>No watchlists yet. Create one to start tracking whales!</p>
                </div>
            ) : (
                <div className="watchlist-grid">
                    {watchlists.map(wl => (
                        <div
                            key={wl._id}
                            className={`watchlist-card ${!wl.isActive ? 'watchlist-card--inactive' : ''}`}
                        >
                            <div className="watchlist-card__header">
                                <h3 className="watchlist-card__name">{wl.name}</h3>
                                <button
                                    className={`status-toggle ${wl.isActive ? 'status-toggle--on' : 'status-toggle--off'}`}
                                    onClick={() => toggleActive(wl)}
                                    title={wl.isActive ? 'Active' : 'Paused'}
                                >
                                    {wl.isActive ? '●' : '○'}
                                </button>
                            </div>

                            <div className="watchlist-card__stats">
                                <div className="stat">
                                    <span className="stat-value">{wl.wallets.length}</span>
                                    <span className="stat-label">Wallets</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-value">{formatMoney(wl.alertConfig.minTradeSize)}</span>
                                    <span className="stat-label">Min Size</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-value">{wl.alertConfig.minScore}</span>
                                    <span className="stat-label">Min Score</span>
                                </div>
                            </div>

                            {wl.alertConfig.categories.length > 0 && (
                                <div className="watchlist-card__categories">
                                    {wl.alertConfig.categories.slice(0, 3).map(cat => (
                                        <span key={cat} className="mini-chip">{CATEGORY_LABELS[cat]?.split(' ')[0]}</span>
                                    ))}
                                    {wl.alertConfig.categories.length > 3 && (
                                        <span className="mini-chip">+{wl.alertConfig.categories.length - 3}</span>
                                    )}
                                </div>
                            )}

                            <div className="watchlist-card__actions">
                                <button
                                    className="btn btn--ghost btn--xs"
                                    onClick={() => startEdit(wl)}
                                >
                                    Edit
                                </button>
                                <button
                                    className="btn btn--danger btn--xs"
                                    onClick={() => handleDelete(wl._id)}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
