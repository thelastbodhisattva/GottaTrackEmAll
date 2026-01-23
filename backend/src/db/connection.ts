import mongoose from 'mongoose';
import { config } from '../config/index.js';

let isConnected = false;

/**
 * Connect to MongoDB with retry logic
 */
export async function connectToMongoDB(): Promise<void> {
    if (isConnected) {
        console.log('[MongoDB] Already connected');
        return;
    }

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            await mongoose.connect(config.mongodbUri, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });

            isConnected = true;
            console.log('[MongoDB] Connected successfully');

            // Handle connection events
            mongoose.connection.on('error', (err) => {
                console.error('[MongoDB] Connection error:', err);
                isConnected = false;
            });

            mongoose.connection.on('disconnected', () => {
                console.warn('[MongoDB] Disconnected');
                isConnected = false;
            });

            return;
        } catch (error) {
            attempt++;
            console.error(`[MongoDB] Connection attempt ${attempt}/${maxRetries} failed:`, error);

            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
                console.log(`[MongoDB] Retrying in ${delay / 1000}s...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    console.error('[MongoDB] All connection attempts failed');
    // Don't throw - allow app to run in degraded mode without persistence
}

/**
 * Check if MongoDB is connected
 */
export function isMongoDBConnected(): boolean {
    return isConnected && mongoose.connection.readyState === 1;
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectFromMongoDB(): Promise<void> {
    if (isConnected) {
        await mongoose.disconnect();
        isConnected = false;
        console.log('[MongoDB] Disconnected');
    }
}

export const disconnectDB = disconnectFromMongoDB;

export { mongoose };
