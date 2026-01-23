/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse with tiered limits
 */
import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// Standard API rate limit: 100 requests per minute
export const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: 60,
    },
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: 60,
        });
    },
});

// Admin API rate limit: 30 requests per minute (stricter)
export const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: {
        error: 'Too many admin requests',
        message: 'Admin rate limit exceeded.',
        retryAfter: 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// WebSocket connection limit: 10 new connections per minute per IP
export const wsConnectionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: {
        error: 'Too many WebSocket connections',
        message: 'Connection rate limit exceeded.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Trade data endpoint limit: 200 requests per minute (higher for real-time)
export const tradeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: {
        error: 'Too many data requests',
        message: 'Data rate limit exceeded.',
        retryAfter: 60,
    },
    standardHeaders: true,
    legacyHeaders: false,
});
