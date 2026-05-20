import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isRedisConnected, disconnectRedis } from '../cache/redis.js';
import { isMongoDBConnected, disconnectDB } from '../db/index.js';

describe('E2E API Tests', () => {
    let app: any;

    // Wait for DB connections if needed, though app usually connects on import/start
    beforeAll(async () => {
        // Disable Redis for E2E tests to prevent connection error logs
        process.env.REDIS_ENABLED = 'false';

        const mod = await import('../app.js');
        app = mod.app;

        // Give some time for async connections to establish
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    afterAll(async () => {
        // Cleanup connections to allow tests to exit cleanly
        await disconnectRedis();
        await disconnectDB();
    });

    describe('Health Check', () => {
        it('should return health status', async () => {
            const res = await request(app).get('/health');
            expect([200, 503]).toContain(res.status);
            expect(['ok', 'degraded', 'unhealthy']).toContain(res.body.status);
            expect(res.body.version).toBeDefined();
        });
    });

    describe('Metrics Endpoint', () => {
        it('should expose Prometheus metrics', async () => {
            const res = await request(app).get('/metrics');
            expect(res.status).toBe(200);
            expect(res.text).toContain('process_cpu_user_seconds_total');
        });
    });

    describe('Trades API', () => {
        it('should return list of trades', async () => {
            const res = await request(app).get('/api/trades?limit=5');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);

            if (res.body.data.length > 0) {
                const trade = res.body.data[0];
                expect(trade.id).toBeDefined();
                expect(trade.sizeUsd).toBeDefined();
            }
        });

        it('should validate query parameters', async () => {
            // Negative limit should be handled or clamped (our validation schema handles string parsing)
            // Zod schema might coerce or fail. Let's see. 
            // If we send invalid param type that Express can't parse or Zod rejects:
            const res = await request(app).get('/api/trades?limit=invalid');
            // Depending on Zod setup, might return 400 or just use default.
            // Our schema implementation: z.coerce.number().int().positive().optional()
            // "invalid" string to number coercion usually results in NaN which fails Zod validation -> 400
            expect(res.status).toBe(400);
        });
    });

    describe('Documentation', () => {
        it('should serve Swagger UI', async () => {
            const res = await request(app).get('/api-docs/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('<title>Swagger UI</title>');
        });
    });
});
