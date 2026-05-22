import WebSocket from 'ws';
import logger, { logWebSocket } from '@/logging';
import { WS } from '@/constants';
import { EventEmitter } from 'events';
import { config } from '@/config';


export interface WebSocketConfig {
  url: string;
  subscriptions: string[];
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
}

export class BinanceWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private subscriptions: Set<string>;
  private reconnectDelay: number;
  private maxReconnectDelay: number;
  private heartbeatInterval: number;
  private reconnectAttempts: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isIntentionallyClosed: boolean = false;
  private messageQueue: any[] = [];
  private lastMessageTime: number = Date.now();
  private pendingSubscriptions: Set<string> = new Set();

  constructor(config: WebSocketConfig) {
    super();
    this.url = config.url;
    this.subscriptions = new Set(config.subscriptions);
    this.reconnectDelay = config.reconnectDelay || WS.RECONNECT_DELAY_MS;
    this.maxReconnectDelay = config.maxReconnectDelay || WS.MAX_RECONNECT_DELAY_MS;
    this.heartbeatInterval = config.heartbeatInterval || WS.HEARTBEAT_INTERVAL_MS;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.isIntentionallyClosed = false;
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          logger.info(`WebSocket connected to ${this.url}`);
          this.reconnectAttempts = 0;
          this.reconnectDelay = WS.RECONNECT_DELAY_MS;
          this.emit('connected');
          this.subscribeToStreams();
          this.startHeartbeat();
          this.flushMessageQueue();
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          logger.error(`WebSocket error: ${error.message}`);
          this.emit('error', error);
        });

        this.ws.on('close', () => {
          logger.warn('WebSocket closed');
          this.stopHeartbeat();
          this.emit('disconnected');
          if (!this.isIntentionallyClosed) {
            this.attemptReconnect();
          }
        });

        // Connection timeout
        setTimeout(() => {
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket connection timeout'));
            if (this.ws) this.ws.close();
          }
        }, 5000);
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      this.lastMessageTime = Date.now();
      const message = JSON.parse(data.toString());

      // Log message for debugging
      logWebSocket({
        event: message.e,
        pair: message.s,
        timestamp: Date.now(),
      });

      // Emit the message
      this.emit('message', message);

      // Handle specific event types
      if (message.e === 'kline') {
        this.emit('kline', message);
      } else if (message.e === 'trade') {
        this.emit('trade', message);
      } else if (message.e === 'depth') {
        this.emit('depth', message);
      }
    } catch (error) {
      logger.warn(`Failed to parse WebSocket message: ${error}`);
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  private subscribeToStreams(): void {
    if (this.subscriptions.size === 0) return;

    const streams = Array.from(this.subscriptions);
    const message = {
      method: 'SUBSCRIBE',
      params: streams,
      id: Date.now(),
    };

    this.send(message);
    logger.info(`Subscribed to ${streams.length} streams`);
  }

  subscribe(stream: string): void {
    if (this.subscriptions.has(stream)) return;

    this.subscriptions.add(stream);
    this.pendingSubscriptions.add(stream);

    if (this.isConnected()) {
      const message = {
        method: 'SUBSCRIBE',
        params: [stream],
        id: Date.now(),
      };
      this.send(message);
      this.pendingSubscriptions.delete(stream);
    }
  }

  unsubscribe(stream: string): void {
    this.subscriptions.delete(stream);
    this.pendingSubscriptions.delete(stream);

    if (this.isConnected()) {
      const message = {
        method: 'UNSUBSCRIBE',
        params: [stream],
        id: Date.now(),
      };
      this.send(message);
    }
  }

  send(message: any): void {
    if (!this.isConnected()) {
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws!.send(JSON.stringify(message));
    } catch (error) {
      logger.warn(`Failed to send WebSocket message: ${error}`);
      this.messageQueue.push(message);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const timeSinceLastMessage = Date.now() - this.lastMessageTime;

      if (timeSinceLastMessage > this.heartbeatInterval * 2) {
        logger.warn('WebSocket heartbeat timeout - reconnecting');
        this.reconnect();
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (this.isIntentionallyClosed) return;

    this.reconnectAttempts++;
    this.reconnectDelay = Math.min(
      this.reconnectDelay * WS.BACKOFF_MULTIPLIER,
      this.maxReconnectDelay
    );

    logger.info(`Attempting to reconnect (attempt ${this.reconnectAttempts}) in ${this.reconnectDelay}ms`);

    setTimeout(() => {
      this.connect().catch((error) => {
        logger.error(`Reconnection failed: ${error.message}`);
        this.attemptReconnect();
      });
    }, this.reconnectDelay);
  }

  async reconnect(): Promise<void> {
    this.disconnect();
    await this.connect();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getQueueSize(): number {
    return this.messageQueue.length;
  }

  getPendingSubscriptions(): string[] {
    return Array.from(this.pendingSubscriptions);
  }

  getActiveSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }
}

export class WebSocketManager extends EventEmitter {
  private clients: Map<string, BinanceWebSocket> = new Map();
  private baseUrl: string;

  constructor(baseUrl: string = 'wss://stream.binance.com:9443/ws') {
    super();
    this.baseUrl = baseUrl;
  }

  createClient(clientId: string, subscriptions: string[] = []): BinanceWebSocket {
    if (this.clients.has(clientId)) {
      return this.clients.get(clientId)!;
    }

    const client = new BinanceWebSocket({
      url: this.baseUrl,
      subscriptions,
    });

    this.clients.set(clientId, client);

    // Relay events
    client.on('connected', () => this.emit('client-connected', clientId));
    client.on('disconnected', () => this.emit('client-disconnected', clientId));
    client.on('error', (error) => this.emit('client-error', { clientId, error }));
    client.on('message', (message) => this.emit('message', { clientId, message }));

    return client;
  }

  getClient(clientId: string): BinanceWebSocket | undefined {
    return this.clients.get(clientId);
  }

  async connectClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Client ${clientId} not found`);
    await client.connect();
  }

  disconnectClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.disconnect();
    }
  }

  disconnectAll(): void {
    this.clients.forEach((client) => client.disconnect());
    this.clients.clear();
  }

  getConnectionStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    this.clients.forEach((client, id) => {
      status[id] = client.isConnected();
    });
    return status;
  }
}

export const wsManager = new WebSocketManager(config.binanceWsUrl);
