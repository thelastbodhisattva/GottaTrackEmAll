/**
 * Zod Validation Schemas
 * Input validation for all API endpoints
 */
import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ============================================================================
// Common Validators
// ============================================================================

// Ethereum address validator
const ethereumAddress = z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format');

// Pagination schema
const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

// Date range schema
const dateRangeSchema = z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
}).refine(
    (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
    { message: 'startDate must be before endDate' }
);

// Boolean from string helper (for query params)
const booleanFromString = z.string()
    .optional()
    .transform(v => v === 'true')
    .default(false);

// ============================================================================
// Trade Endpoints
// ============================================================================

export const tradesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    flaggedOnly: booleanFromString,
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    maxScore: z.coerce.number().int().min(0).max(100).optional(),
    category: z.enum(['geopolitics', 'war', 'crypto', 'other', 'all']).default('all'),
    side: z.enum(['YES', 'NO', 'all']).default('all'),
    minSize: z.coerce.number().min(0).optional(),
});

export type TradesQuery = z.infer<typeof tradesQuerySchema>;

// ============================================================================
// Wallet Endpoints
// ============================================================================

export const walletParamsSchema = z.object({
    address: ethereumAddress,
});

export const walletQuerySchema = z.object({
    includeTrades: booleanFromString,
    tradeLimit: z.coerce.number().int().min(1).max(100).default(20),
});

export type WalletParams = z.infer<typeof walletParamsSchema>;
export type WalletQuery = z.infer<typeof walletQuerySchema>;

// ============================================================================
// Market Endpoints
// ============================================================================

export const marketParamsSchema = z.object({
    marketId: z.string().min(1, 'Market ID is required'),
});

export const marketQuerySchema = z.object({
    includeResolution: booleanFromString,
});

export type MarketParams = z.infer<typeof marketParamsSchema>;
export type MarketQuery = z.infer<typeof marketQuerySchema>;

// ============================================================================
// Admin Endpoints
// ============================================================================

export const adminStatsQuerySchema = z.object({
    ...dateRangeSchema.shape,
    ...paginationSchema.shape,
});

export const flaggedWalletsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(10),
    minScore: z.coerce.number().int().min(0).max(100).default(65),
    sortBy: z.enum(['score', 'volume', 'trades', 'lastActive']).default('score'),
    order: z.enum(['asc', 'desc']).default('desc'),
});

export const factorBreakdownQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(90).default(30),
});

export type AdminStatsQuery = z.infer<typeof adminStatsQuerySchema>;
export type FlaggedWalletsQuery = z.infer<typeof flaggedWalletsQuerySchema>;
export type FactorBreakdownQuery = z.infer<typeof factorBreakdownQuerySchema>;

// ============================================================================
// WebSocket Authentication
// ============================================================================

export const wsAuthSchema = z.object({
    token: z.string().min(32, 'Invalid token format'),
    subscriptions: z.array(z.string()).optional(),
});

export type WsAuth = z.infer<typeof wsAuthSchema>;

// ============================================================================
// Validation Middleware Helper
// ============================================================================

type ValidationTarget = 'query' | 'params' | 'body';

/**
 * Create validation middleware for a Zod schema
 */
export function validate<T extends z.ZodSchema>(
    schema: T,
    target: ValidationTarget = 'query'
): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req[target]);

        if (!result.success) {
            const errors = result.error.issues.map((issue: z.ZodIssue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            }));

            res.status(400).json({
                error: 'Validation failed',
                details: errors,
            });
            return;
        }

        // Replace with parsed and validated data
        (req as unknown as Record<string, unknown>)[target] = result.data;
        next();
    };
}

/**
 * Validate multiple targets at once
 */
export function validateMultiple(schemas: {
    query?: z.ZodSchema;
    params?: z.ZodSchema;
    body?: z.ZodSchema;
}): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
        const errors: Array<{ target: string; field: string; message: string }> = [];

        for (const [target, schema] of Object.entries(schemas)) {
            if (schema) {
                const result = schema.safeParse(req[target as ValidationTarget]);
                if (!result.success) {
                    result.error.issues.forEach((issue: z.ZodIssue) => {
                        errors.push({
                            target,
                            field: issue.path.join('.'),
                            message: issue.message,
                        });
                    });
                } else {
                    (req as unknown as Record<string, unknown>)[target] = result.data;
                }
            }
        }

        if (errors.length > 0) {
            res.status(400).json({
                error: 'Validation failed',
                details: errors,
            });
            return;
        }

        next();
    };
}
