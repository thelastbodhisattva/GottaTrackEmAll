/**
 * Prometheus Metrics Middleware
 * Exposes application metrics for monitoring
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { Request, Response, NextFunction } from 'express';

// Create a new registry
export const metricsRegistry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: metricsRegistry });

// ============================================================================
// Custom Metrics
// ============================================================================

// Trade counters
export const tradeCounter = new Counter({
    name: 'whale_trades_total',
    help: 'Total number of whale trades processed',
    labelNames: ['category', 'side'],
    registers: [metricsRegistry],
});

export const flaggedTradeCounter = new Counter({
    name: 'flagged_trades_total',
    help: 'Total number of trades flagged as potential insider activity',
    labelNames: ['confidence'],
    registers: [metricsRegistry],
});

// Processing duration histogram
export const tradeProcessingDuration = new Histogram({
    name: 'trade_processing_duration_seconds',
    help: 'Time taken to process and score a trade',
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metricsRegistry],
});

// WebSocket connections gauge
export const wsConnectionsGauge = new Gauge({
    name: 'websocket_connections_active',
    help: 'Number of active WebSocket connections',
    registers: [metricsRegistry],
});

// API request counter
export const apiRequestCounter = new Counter({
    name: 'api_requests_total',
    help: 'Total API requests',
    labelNames: ['method', 'path', 'status'],
    registers: [metricsRegistry],
});

// API latency histogram
export const apiLatencyHistogram = new Histogram({
    name: 'api_request_duration_seconds',
    help: 'API request latency',
    labelNames: ['method', 'path'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [metricsRegistry],
});

// Score distribution histogram
export const scoreHistogram = new Histogram({
    name: 'insider_score_distribution',
    help: 'Distribution of insider scores',
    buckets: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    registers: [metricsRegistry],
});

// Cache hit/miss counters
export const cacheHitCounter = new Counter({
    name: 'cache_hits_total',
    help: 'Total cache hits',
    labelNames: ['cache_type'],
    registers: [metricsRegistry],
});

export const cacheMissCounter = new Counter({
    name: 'cache_misses_total',
    help: 'Total cache misses',
    labelNames: ['cache_type'],
    registers: [metricsRegistry],
});

// Error counter
export const errorCounter = new Counter({
    name: 'errors_total',
    help: 'Total errors by type',
    labelNames: ['type', 'service'],
    registers: [metricsRegistry],
});

// ============================================================================
// Middleware
// ============================================================================

/**
 * Express middleware to track request metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();

    // On response finish, record metrics
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const path = normalizePath(req.path);

        apiRequestCounter.inc({
            method: req.method,
            path,
            status: res.statusCode.toString(),
        });

        apiLatencyHistogram.observe(
            { method: req.method, path },
            duration
        );
    });

    next();
}

/**
 * Normalize path for metric labels (avoid high cardinality)
 */
function normalizePath(path: string): string {
    // Replace IDs and hashes with placeholders
    return path
        .replace(/\/0x[a-fA-F0-9]+/g, '/:address')
        .replace(/\/[a-fA-F0-9]{40,}/g, '/:hash')
        .replace(/\/\d+/g, '/:id');
}

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
    return metricsRegistry.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
    return metricsRegistry.contentType;
}
