import { MarketCategory } from '../types';

interface FiltersBarProps {
    category: MarketCategory | 'all';
    onCategoryChange: (category: MarketCategory | 'all') => void;
    flaggedOnly: boolean;
    onFlaggedOnlyChange: (flaggedOnly: boolean) => void;
    minSize: number;
    onMinSizeChange: (size: number) => void;
}

export function FiltersBar({
    category,
    onCategoryChange,
    flaggedOnly,
    onFlaggedOnlyChange,
    minSize,
    onMinSizeChange,
}: FiltersBarProps) {
    return (
        <div className="filters-bar">
            <div className="filter-group">
                <span className="filter-label">Category</span>
                <select
                    className="filter-select"
                    value={category}
                    onChange={(e) => onCategoryChange(e.target.value as MarketCategory | 'all')}
                >
                    <option value="all">All Markets</option>
                    <option value="geopolitics">🗳️ Geopolitics</option>
                    <option value="war">⚔️ War</option>
                    <option value="crypto">₿ Crypto</option>
                    <option value="other">📊 Other</option>
                </select>
            </div>

            <div className="filter-group">
                <span className="filter-label">Min Size</span>
                <select
                    className="filter-select"
                    value={minSize}
                    onChange={(e) => onMinSizeChange(parseInt(e.target.value, 10))}
                >
                    <option value="1000">$1,000+</option>
                    <option value="5000">$5,000+</option>
                    <option value="10000">$10,000+</option>
                    <option value="50000">$50,000+</option>
                    <option value="100000">$100,000+</option>
                </select>
            </div>

            <label className="filter-checkbox">
                <input
                    type="checkbox"
                    checked={flaggedOnly}
                    onChange={(e) => onFlaggedOnlyChange(e.target.checked)}
                />
                <span>🚨 Insider Signals Only</span>
            </label>
        </div>
    );
}
