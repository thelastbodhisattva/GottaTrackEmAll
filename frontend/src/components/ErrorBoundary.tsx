import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * React Error Boundary component to catch and handle errors in child components.
 * Prevents entire app crash when a single component fails.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="error-boundary-fallback">
                    <div className="error-icon">⚠️</div>
                    <h3>Something went wrong</h3>
                    <p className="error-message">
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </p>
                    <button
                        className="error-retry-btn"
                        onClick={() => this.setState({ hasError: false, error: null })}
                    >
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * Trade-specific error boundary with whale-themed fallback
 */
export function TradeErrorFallback(): JSX.Element {
    return (
        <div className="trade-error-fallback">
            <div className="error-icon">🐋💨</div>
            <p>Failed to load trade data. The whale got away!</p>
            <button
                className="error-retry-btn"
                onClick={() => window.location.reload()}
            >
                Refresh Page
            </button>
        </div>
    );
}
