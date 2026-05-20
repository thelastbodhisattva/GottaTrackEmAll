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

// =============================================================================
// Polymarket Infrastructure Constants
// =============================================================================

/**
 * Known Polymarket exchange and infrastructure contracts.
 * These addresses appear as maker/taker in batch orders but are NOT user wallets.
 */
export const POLYMARKET_EXCHANGE_ADDRESSES = [
    // V1 CTF Exchange
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    // V1 NegRisk Exchange
    '0xc5d563a36ae78145c45a50134d48a1215220f80a',
    // V2 CTF Exchange
    '0xe111180000d2663c0091e4f400237545b87b996b',
    // V2 NegRisk Exchange A
    '0xe2222d279d744050d28e00520010520000310f59',
    // V2 NegRisk Exchange B
    '0xe2222d002000ba0053cef3375333610f64600036',
    // NegRisk Adapter
    '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
    // NegRisk Fee Module
    '0x78769d50be1763ed1ca0d5e878d93f05aabff29e',
    // CTF Fee Module (often appears as tx.to)
    '0xe3f18acc55b23a9c69a77fa1e7be3dd0f8e8048d',
    // Polymarket Relay Hub
    '0xd216153c06e857cd7f72665e0af1d7d82172f494',
].map(addr => addr.toLowerCase());

/**
 * Check if an address is a known Polymarket infrastructure contract
 */
export function isExchangeContract(address: string): boolean {
    return POLYMARKET_EXCHANGE_ADDRESSES.includes(address.toLowerCase());
}
