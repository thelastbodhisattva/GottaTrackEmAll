/**
 * WebSocket Authentication Middleware
 * Token-based authentication for sensitive WebSocket connections
 */
import crypto from 'crypto';

// Store active tokens (in production, use Redis)
const activeTokens = new Map<string, { expiresAt: number; permissions: string[] }>();

// Token expiry time: 24 hours
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Generate a new WebSocket authentication token
 */
export function generateWsToken(permissions: string[] = ['read']): string {
    const token = crypto.randomBytes(32).toString('hex');

    activeTokens.set(token, {
        expiresAt: Date.now() + TOKEN_EXPIRY_MS,
        permissions,
    });

    // Clean up expired tokens periodically
    cleanupExpiredTokens();

    return token;
}

/**
 * Validate a WebSocket token
 */
export function validateWsToken(token: string): { valid: boolean; permissions: string[] } {
    const tokenData = activeTokens.get(token);

    if (!tokenData) {
        return { valid: false, permissions: [] };
    }

    if (Date.now() > tokenData.expiresAt) {
        activeTokens.delete(token);
        return { valid: false, permissions: [] };
    }

    return { valid: true, permissions: tokenData.permissions };
}

/**
 * Revoke a WebSocket token
 */
export function revokeWsToken(token: string): boolean {
    return activeTokens.delete(token);
}

/**
 * Check if a token has a specific permission
 */
export function hasPermission(token: string, permission: string): boolean {
    const { valid, permissions } = validateWsToken(token);
    return valid && (permissions.includes(permission) || permissions.includes('admin'));
}

/**
 * Clean up expired tokens
 */
function cleanupExpiredTokens(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, data] of activeTokens) {
        if (now > data.expiresAt) {
            activeTokens.delete(token);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`[WsAuth] Cleaned up ${cleaned} expired tokens`);
    }
}

/**
 * Get count of active tokens
 */
export function getActiveTokenCount(): number {
    cleanupExpiredTokens();
    return activeTokens.size;
}
