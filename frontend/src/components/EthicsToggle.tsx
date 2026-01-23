import { ViewMode } from '../types';

interface EthicsToggleProps {
    mode: ViewMode;
    onChange: (mode: ViewMode) => void;
}

export function EthicsToggle({ mode, onChange }: EthicsToggleProps) {
    const isEfficiency = mode === 'efficiency';

    const handleToggle = () => {
        onChange(isEfficiency ? 'neutral' : 'efficiency');
    };

    return (
        <div className="ethics-toggle">
            <label>
                <input
                    type="checkbox"
                    checked={isEfficiency}
                    onChange={handleToggle}
                />
                <span className="slider" />
            </label>
            <div>
                <span className="ethics-toggle-label">
                    {isEfficiency ? 'Efficiency View' : 'Neutral View'}
                </span>
                {isEfficiency && (
                    <span className="ethics-toggle-hint">
                        Showing Hanson's market efficiency insights
                    </span>
                )}
            </div>
        </div>
    );
}
