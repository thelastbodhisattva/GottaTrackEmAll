import { useEffect, useRef, useState, useCallback } from 'react';
import { EnrichedTrade } from '../types';

interface UseWebSocketReturn {
    trades: EnrichedTrade[];
    isConnected: boolean;
    error: string | null;
    reconnect: () => void;
}

export function useWebSocket(maxTrades: number = 100, authToken?: string): UseWebSocketReturn {
    const [trades, setTrades] = useState<EnrichedTrade[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const seenTradeIds = useRef<Set<string>>(new Set());

    const connect = useCallback(() => {
        // Guard: Don't create duplicate connections
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            console.log('[WS] Already connected, skipping');
            return;
        }

        try {
            // Use relative WebSocket URL (proxied by Vite in dev)
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            // Support optional auth token for secured deployments
            const wsUrl = authToken
                ? `${protocol}//${window.location.host}/ws?token=${authToken}`
                : `${protocol}//${window.location.host}/ws`;

            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                console.log('[WS] Connected');
                setIsConnected(true);
                setError(null);
            };

            wsRef.current.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    if (message.type === 'trade') {
                        const trade = message.data;
                        const tradeId = trade.id;

                        // Deduplicate: Skip if we've already seen this trade
                        if (seenTradeIds.current.has(tradeId)) {
                            console.log(`[WS] Skipping duplicate trade: ${tradeId}`);
                            return;
                        }

                        seenTradeIds.current.add(tradeId);

                        // Limit seen IDs cache size to prevent memory leak
                        if (seenTradeIds.current.size > 1000) {
                            const iterator = seenTradeIds.current.values();
                            for (let i = 0; i < 500; i++) {
                                const val = iterator.next().value;
                                if (val) seenTradeIds.current.delete(val);
                            }
                        }

                        setTrades((prev) => {
                            const newTrades = [trade, ...prev];
                            return newTrades.slice(0, maxTrades);
                        });
                    }
                } catch (e) {
                    console.error('[WS] Failed to parse message:', e);
                }
            };

            wsRef.current.onclose = () => {
                console.log('[WS] Disconnected');
                setIsConnected(false);

                // Auto-reconnect after 3 seconds
                reconnectTimeoutRef.current = setTimeout(() => {
                    connect();
                }, 3000);
            };

            wsRef.current.onerror = (e) => {
                console.error('[WS] Error:', e);
                setError('WebSocket connection error');
            };
        } catch (e) {
            console.error('[WS] Failed to connect:', e);
            setError('Failed to establish WebSocket connection');
        }
    }, [maxTrades, authToken]);

    const reconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }
        connect();
    }, [connect]);

    useEffect(() => {
        connect();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [connect]);

    return { trades, isConnected, error, reconnect };
}
