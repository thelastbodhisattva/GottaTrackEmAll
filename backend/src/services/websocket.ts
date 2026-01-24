import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../config/index.js';
import { RawTrade } from '../types/index.js';

interface PolymarketWebSocketEvents {
    trade: (trade: RawTrade) => void;
    connected: () => void;
    disconnected: () => void;
    error: (error: Error) => void;
}

/**
 * WebSocket client for Polymarket CLOB real-time trade stream
 * Implements auto-reconnect with exponential backoff
 */
export class PolymarketWebSocket extends EventEmitter {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private readonly maxReconnects = 10;
    private readonly wsUrl: string;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private subscribedAssets: string[] = [];
    private isConnecting = false;
    private isRefreshing = false;  // Prevent concurrent refresh operations

    // Reconnect cooldown: reset attempts after 10 min of stable connection
    private lastSuccessfulConnection = 0;
    private readonly reconnectCooldownMs = 10 * 60 * 1000; // 10 minutes

    // Diagnostic counters
    private messageCount = 0;
    private tradeEmitCount = 0;
    private lastStatsTime = Date.now();

    constructor(wsUrl?: string) {
        super();
        this.wsUrl = wsUrl || config.polymarket.wsUrl;
    }

    /**
     * Connect to Polymarket WebSocket and subscribe to asset trades
     * @param assetIds - List of CLOB asset IDs to subscribe to
     */
    async connect(assetIds: string[]): Promise<void> {
        if (this.isConnecting) {
            console.log('[WS] Connection already in progress');
            return;
        }

        this.isConnecting = true;
        this.subscribedAssets = assetIds;

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);
                console.log(`[WS] Connecting to: ${this.wsUrl}`);

                this.ws.on('open', async () => {
                    console.log('[WS] Connected to Polymarket');
                    this.reconnectAttempts = 0;
                    this.lastSuccessfulConnection = Date.now();
                    this.isConnecting = false;
                    this.startHeartbeat();
                    await this.subscribeToAssets(assetIds);
                    this.emit('connected');
                    resolve();
                });

                this.ws.on('message', (data: Buffer) => {
                    this.handleMessage(data);
                });

                this.ws.on('close', (code, reason) => {
                    console.log(`[WS] Disconnected: ${code} - ${reason.toString()}`);
                    this.isConnecting = false;
                    this.stopHeartbeat();
                    this.emit('disconnected');
                    this.handleReconnect();
                });

                this.ws.on('error', (err) => {
                    console.error('[WS] Error:', err.message);
                    this.isConnecting = false;
                    this.emit('error', err);
                    reject(err);
                });

            } catch (error) {
                this.isConnecting = false;
                reject(error);
            }
        });
    }

    /**
     * Update subscriptions with new assets
     * dynamically adds new markets to the stream
     */
    async updateSubscriptions(newAssetIds: string[]): Promise<void> {
        if (!this.isConnected()) {
            console.warn('[WS] Cannot update subscriptions: not connected');
            return;
        }

        // Find assets we aren't already subscribed to
        const distinctNewAssets = newAssetIds.filter(id => !this.subscribedAssets.includes(id));

        if (distinctNewAssets.length === 0) {
            console.log('[WS] No new assets to subscribe to');
            return;
        }

        console.log(`[WS] Adding ${distinctNewAssets.length} new assets to subscription...`);

        // Add to our tracked list
        this.subscribedAssets = [...new Set([...this.subscribedAssets, ...distinctNewAssets])];

        // Send subscription message only for the new ones
        await this.subscribeToAssets(distinctNewAssets);
    }

    /**
     * Subscribe to trade updates for given assets
     * Uses Polymarket CLOB WebSocket subscription format
     */
    private async subscribeToAssets(assetIds: string[]): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('[WS] Cannot subscribe: not connected');
            return;
        }

        // Sanitize asset IDs
        const validAssetIds = assetIds.filter(id => id && typeof id === 'string' && id.length > 0);

        if (validAssetIds.length === 0) {
            console.warn('[WS] No valid asset IDs to subscribe to');
            return;
        }

        // Batch subscriptions to avoid payload size limits
        const chunkSize = 50;

        if (assetIds.length > 0) {
            console.log(`[WS] Sample Asset ID: ${assetIds[0]}`);
        }

        for (let i = 0; i < validAssetIds.length; i += chunkSize) {
            // Check connection state before each batch (due to async delays)
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                console.warn('[WS] Connection lost during subscription');
                break;
            }

            const chunk = validAssetIds.slice(i, i + chunkSize);
            const isInitial = i === 0;

            // CORRECT PROTOCOL:
            // Initial batch (right after connect): needs "type": "market"
            // Subsequent batches (adding signatures): needs "operation": "subscribe"
            interface SubscriptionMessage {
                assets_ids: string[];
                type?: string;
                operation?: string;
            }

            const subscribeMessage: SubscriptionMessage = {
                assets_ids: chunk
            };

            if (isInitial) {
                subscribeMessage.type = 'market';
            } else {
                subscribeMessage.operation = 'subscribe';
            }

            console.log(`[WS] Subscribing to batch ${Math.floor(i / chunkSize) + 1}/${Math.ceil(validAssetIds.length / chunkSize)} (${chunk.length} assets) - ${isInitial ? 'INITIAL' : 'UPDATE'}`);
            // console.log(`[WS] Payload Preview: ${JSON.stringify(subscribeMessage).slice(0, 100)}...`); 
            this.ws.send(JSON.stringify(subscribeMessage));

            // Rate limit subscriptions to avoid overload
            // User recommended 500ms
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`[WS] Sent subscriptions for ${validAssetIds.length} assets`);
    }

    /**
     * Handle incoming WebSocket messages
     * Polymarket sends various event types including price_change, last_trade_price
     */
    private handleMessage(data: Buffer): void {
        try {
            const dataStr = data.toString();

            // Skip non-JSON responses (like "INVALID OPERATION")
            if (!dataStr.startsWith('{') && !dataStr.startsWith('[')) {
                if (dataStr !== 'PONG' && dataStr !== 'PONG_JSON') {
                    console.log(`[WS] Non-JSON message: ${dataStr.slice(0, 50)}`);
                }
                return;
            }

            const message = JSON.parse(dataStr);

            // Handle array of messages
            if (Array.isArray(message)) {
                for (const msg of message) {
                    this.processMessage(msg);
                }
            } else {
                this.processMessage(message);
            }
        } catch (error) {
            // Only log if it's not an expected non-JSON message
            const dataStr = data.toString();
            if (dataStr.startsWith('{') || dataStr.startsWith('[')) {
                console.error('[WS] Failed to parse message:', error);
            }
        }
    }

    /**
     * Process a single message from the WebSocket
     */
    private processMessage(message: Record<string, unknown>): void {
        // Handle price change events (contains trade info)
        // NOTE: price_change events often don't include maker_address - we still emit them
        // and let the tradeProcessor handle wallet resolution via on-chain lookup
        if (message.event_type === 'price_change' || message.event_type === 'last_trade_price') {
            const makerAddr = (message.maker_address as string) || '';
            const takerAddr = (message.taker_address as string) || '';

            const trade: RawTrade = {
                id: crypto.randomUUID(),
                market: (message.market as string) || '',
                asset_id: (message.asset_id as string) || '',
                side: (message.side as string) || 'BUY',
                price: String(message.price || message.last_trade_price || 0),
                size: String(message.size || 0),
                maker_address: makerAddr,
                taker_address: takerAddr,
                timestamp: (message.timestamp as string) || new Date().toISOString(),
                // price_change events don't have tx hash - will be fetched via Data API
                transaction_hash: '',
            };

            // Only emit if we have meaningful trade data (size > 0)
            if (trade.asset_id && parseFloat(trade.size) > 0) {
                this.tradeEmitCount++;
                this.logPeriodicStats();
                this.emit('trade', trade);
            }
        }
        // Handle trade events directly
        else if (message.event_type === 'trade' && message.data) {
            const tradeData = message.data as Record<string, unknown>;
            const makerAddr = (tradeData.maker_address as string) || '';
            const takerAddr = (tradeData.taker_address as string) || '';

            const trade: RawTrade = {
                id: (tradeData.id as string) || crypto.randomUUID(),
                market: (tradeData.market as string) || '',
                asset_id: (tradeData.asset_id as string) || '',
                side: (tradeData.side as string) || '',
                price: String(tradeData.price || 0),
                size: String(tradeData.size || 0),
                maker_address: makerAddr,
                taker_address: takerAddr,
                timestamp: (tradeData.timestamp as string) || new Date().toISOString(),
                transaction_hash: (tradeData.transaction_hash as string) || '',
            };
            this.emit('trade', trade);
        }
        // Handle subscription confirmation
        else if (message.type === 'subscribed' || message.channel) {
            console.log(`[WS] Subscription confirmed`);
        }
    }

    /**
     * Reset periodic stats counter (called internally)
     */
    private logPeriodicStats(): void {
        const now = Date.now();
        const elapsed = (now - this.lastStatsTime) / 1000;

        if (elapsed >= 30) {
            // Reset counters (no logging - keep console clean)
            this.lastStatsTime = now;
            this.tradeEmitCount = 0;
        }
    }

    /**
     * Start heartbeat to keep connection alive
     */
    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // User specified plain text "PING" for CLOB
                this.ws.send('PING');
            }
        }, 10000); // Ping every 10 seconds as recommended
    }

    /**
     * Stop heartbeat interval
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Handle reconnection with exponential backoff
     */
    private handleReconnect(): void {
        // Reset attempts if connection was stable for 10+ minutes (cooldown window)
        if (this.lastSuccessfulConnection > 0) {
            const stableTime = Date.now() - this.lastSuccessfulConnection;
            if (stableTime >= this.reconnectCooldownMs) {
                console.log(`[WS] Connection was stable for ${Math.floor(stableTime / 60000)}min, resetting attempts`);
                this.reconnectAttempts = 0;
            }
        }

        if (this.reconnectAttempts >= this.maxReconnects) {
            console.error('[WS] Max reconnection attempts reached');
            this.emit('error', new Error('Max reconnection attempts reached'));
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnects})`);

        setTimeout(() => {
            this.connect(this.subscribedAssets).catch((err) => {
                console.error('[WS] Reconnection failed:', err.message);
            });
        }, delay);
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect(): void {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        console.log('[WS] Disconnected');
    }


    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Get currently subscribed asset IDs
     * Returns a copy to prevent external mutation
     */
    getSubscribedAssets(): string[] {
        return [...this.subscribedAssets];
    }

    /**
     * Refresh subscriptions by disconnecting and reconnecting with fresh active markets
     * This removes closed markets from the subscription list
     * @param activeAssetIds - Current list of active market asset IDs
     */
    async refreshSubscriptions(activeAssetIds: string[]): Promise<void> {
        if (activeAssetIds.length === 0) {
            console.warn('[WS] Cannot refresh with empty asset list');
            return;
        }

        // Prevent concurrent refresh operations
        if (this.isRefreshing) {
            console.warn('[WS] Refresh already in progress, skipping...');
            return;
        }

        try {
            this.isRefreshing = true;

            const currentCount = this.subscribedAssets.length;
            const removedCount = currentCount - activeAssetIds.length;

            console.log(`[WS] 🔄 Refreshing subscriptions...`);
            console.log(`[WS]    Current: ${currentCount} assets`);
            console.log(`[WS]    Active: ${activeAssetIds.length} assets`);
            if (removedCount > 0) {
                console.log(`[WS]    Removing: ${removedCount} closed markets`);
            }

            // Disconnect from current WebSocket
            this.disconnect();

            // Wait for clean disconnect
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Reconnect with fresh active markets only
            await this.connect(activeAssetIds);

            console.log(`[WS] ✅ Subscription refresh complete`);
        } finally {
            // Always clear the flag, even if error occurs
            this.isRefreshing = false;
        }
    }


    // Type-safe event emitter methods
    override on<K extends keyof PolymarketWebSocketEvents>(
        event: K,
        listener: PolymarketWebSocketEvents[K]
    ): this {
        return super.on(event, listener);
    }

    override emit<K extends keyof PolymarketWebSocketEvents>(
        event: K,
        ...args: Parameters<PolymarketWebSocketEvents[K]>
    ): boolean {
        return super.emit(event, ...args);
    }
}
