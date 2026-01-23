import swaggerJsdoc from 'swagger-jsdoc';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Polymarket Whale Tracker API',
            version: '1.0.0',
            description: 'API for tracking whale activity and insider trading on Polymarket',
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT',
            },
            contact: {
                name: 'API Support',
                email: 'support@example.com',
            },
        },
        servers: [
            {
                url: 'http://localhost:3001',
                description: 'Development server',
            },
        ],
        components: {
            schemas: {
                Trade: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        marketTitle: { type: 'string' },
                        sizeUsd: { type: 'number' },
                        side: { type: 'string', enum: ['YES', 'NO'] },
                        price: { type: 'number' },
                        timestamp: { type: 'string', format: 'date-time' },
                        isFlagged: { type: 'boolean' },
                    },
                },
                WalletProfile: {
                    type: 'object',
                    properties: {
                        address: { type: 'string' },
                        totalTrades: { type: 'number' },
                        totalPnl: { type: 'number' },
                        winRate: { type: 'number' },
                    },
                },
            },
        },
    },
    apis: ['./src/api/*.ts'], // Path to the API docs
};

export const specs = swaggerJsdoc(options);
