/**
 * Shared utility functions for the whale tracker backend
 */

// =============================================================================
// Error Handling Utilities
// =============================================================================

/**
 * Type guard for errors with a code property (like Node.js errors)
 */
interface ErrorWithCode extends Error {
    code?: string | number;
}

/**
 * Type guard to check if an error has a code property
 */
export function hasErrorCode(error: unknown): error is ErrorWithCode {
    return (
        error instanceof Error &&
        'code' in error &&
        (typeof (error as ErrorWithCode).code === 'string' ||
            typeof (error as ErrorWithCode).code === 'number')
    );
}

/**
 * Check if an error is a transient network error that can be retried
 */
export function isTransientError(error: unknown): boolean {
    if (hasErrorCode(error)) {
        const transientCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'];
        return transientCodes.includes(String(error.code));
    }
    return false;
}

/**
 * Check if an error is a rate limit error (HTTP 429 or specific codes)
 */
export function isRateLimitError(error: unknown): boolean {
    if (hasErrorCode(error)) {
        return error.code === 429 || error.code === '429';
    }
    if (error instanceof Error) {
        return error.message.toLowerCase().includes('rate limit');
    }
    return false;
}

/**
 * Safely extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return String(error);
}

/**
 * Safely extract error code from unknown error type
 */
export function getErrorCode(error: unknown): string | number | undefined {
    if (hasErrorCode(error)) {
        return error.code;
    }
    return undefined;
}

// =============================================================================
// Time Formatting Utilities
// =============================================================================

/**
 * Format relative time (e.g., "2m ago", "1h ago")
 */
export function formatRelativeTime(date: Date | string): string {
    const now = new Date();
    const then = typeof date === 'string' ? new Date(date) : date;
    const diffMs = now.getTime() - then.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format uptime in human-readable format
 */
export function formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

// =============================================================================
// Number Formatting Utilities
// =============================================================================

/**
 * Format USD amount with appropriate suffix (K, M)
 */
export function formatUsd(amount: number): string {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
    return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * Format percentage (0-1 scale to display percentage)
 */
export function formatPercent(value: number, decimals: number = 1): string {
    return `${(value * 100).toFixed(decimals)}%`;
}

// =============================================================================
// Address Utilities
// =============================================================================

/**
 * Truncate Ethereum address for display
 */
export function truncateAddress(address: string, startChars: number = 6, endChars: number = 4): string {
    if (!address || address.length < startChars + endChars + 3) {
        return address;
    }
    return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Normalize Ethereum address to lowercase
 */
export function normalizeAddress(address: string): string {
    return address.toLowerCase();
}

/**
 * Check if string is a valid Ethereum address format
 */
export function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}
