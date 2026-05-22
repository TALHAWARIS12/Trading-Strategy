import { Candle, PartialCandle } from '@/types';
import { getCandleOpenTime, getCandleCloseTime, isCandleClosed, getCurrentTimestamp } from '@/utils';
import { INTERVALS_MS } from '@/constants';
import logger from '@/logging';

export interface KlineData {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  k: {
    t: number;    // Kline start time  ← used as candle timestamp
    T: number;    // Kline close time
    s: string;    // Symbol
    i: string;    // Interval
    f: number;    // First trade ID
    L: number;    // Last trade ID
    o: string;    // Open price
    c: string;    // Close price
    h: string;    // High price
    l: string;    // Low price
    v: string;    // Base asset volume
    n: number;    // Number of trades
    x: boolean;   // Is this kline closed?
    q: string;    // Quote asset volume
    V: string;    // Taker buy base asset volume
    Q: string;    // Taker buy quote asset volume
    B: string;    // Ignore
  };
}

export class CandleBuilder {
  private buffers: Map<string, Candle[]> = new Map();
  private partialCandles: Map<string, PartialCandle> = new Map();
  private lastProcessedTimestamps: Map<string, number> = new Map();
  private closedCandleCallbacks: Map<string, (candle: Candle) => void> = new Map();

  /**
   * Process kline data from WebSocket.
   *
   * Must be called for BOTH open (k.x=false) and closed (k.x=true) events:
   * - Open events update the partial candle so getPartialCandle() returns live price.
   * - Closed events add the candle to the buffer for strategy consumption.
   *
   * Fix: the previous app.ts only forwarded closed candles here, making
   * getPartialCandle() always return null and currentPrice always stale.
   */
  processKline(data: KlineData): Candle | null {
    const { s: pair, k } = data;
    const interval = k.i;
    const bufferKey = `${pair}-${interval}`;

    const candleData: Candle = {
      pair,
      interval,
      timestamp: k.t,           // always use kline OPEN time as the candle timestamp
      open:   parseFloat(k.o),
      high:   parseFloat(k.h),
      low:    parseFloat(k.l),
      close:  parseFloat(k.c),
      volume: parseFloat(k.v),
      isClosed: k.x,
    };

    if (!this.isValidCandle(candleData)) {
      logger.warn(`[CandleBuilder] Invalid candle data for ${bufferKey}: ${JSON.stringify(candleData)}`);
      return null;
    }

    if (!k.x) {
      // In-progress candle — update partial store for live price tracking
      this.partialCandles.set(bufferKey, {
        pair:       candleData.pair,
        interval:   candleData.interval,
        timestamp:  candleData.timestamp,
        open:       candleData.open,
        high:       candleData.high,
        low:        candleData.low,
        close:      candleData.close,
        volume:     candleData.volume,
        isComplete: false,
      });
      return null;
    }

    // Closed candle — add to buffer and clear partial
    return this.processClosedCandle(candleData);
  }

  /**
   * Process a closed candle: deduplicate, gap-detect, buffer, and fire callbacks.
   */
  private processClosedCandle(candleData: Candle): Candle {
    const bufferKey = `${candleData.pair}-${candleData.interval}`;
    const lastTimestamp = this.lastProcessedTimestamps.get(bufferKey) || 0;

    const intervalMs = INTERVALS_MS[candleData.interval as keyof typeof INTERVALS_MS] || 0;

    // Gap detection
    if (lastTimestamp > 0 && intervalMs > 0 && candleData.timestamp - lastTimestamp > intervalMs * 1.5) {
      logger.warn(
        `[CandleBuilder] Missing candle(s) for ${bufferKey}: ` +
        `gap of ${candleData.timestamp - lastTimestamp}ms ` +
        `(expected ~${intervalMs}ms)`
      );
    }

    // Reject out-of-order candles
    if (lastTimestamp > 0 && candleData.timestamp < lastTimestamp) {
      logger.warn(
        `[CandleBuilder] Out-of-order candle for ${bufferKey}: ` +
        `got ${candleData.timestamp}, last was ${lastTimestamp}`
      );
      return candleData;
    }

    // Deduplicate: ignore if we already processed this candle
    if (candleData.timestamp === lastTimestamp) {
      logger.debug(`[CandleBuilder] Duplicate closed candle for ${bufferKey} @ ${candleData.timestamp} — skipped`);
      return candleData;
    }

    this.lastProcessedTimestamps.set(bufferKey, candleData.timestamp);

    const buffer = this.buffers.get(bufferKey) || [];
    buffer.push(candleData);

    // Cap buffer at 500 candles to prevent unbounded memory growth
    const maxBufferSize = 500;
    if (buffer.length > maxBufferSize) {
      buffer.shift();
    }

    this.buffers.set(bufferKey, buffer);

    // Clear the partial candle now that this interval has closed
    this.partialCandles.delete(bufferKey);

    // Fire registered callback
    const callback = this.closedCandleCallbacks.get(bufferKey);
    if (callback) {
      callback(candleData);
    }

    return candleData;
  }

  /**
   * Get the latest closed candle for a pair/interval
   */
  getLatestCandle(pair: string, interval: string): Candle | null {
    const bufferKey = `${pair}-${interval}`;
    const buffer = this.buffers.get(bufferKey);
    return buffer && buffer.length > 0 ? buffer[buffer.length - 1] : null;
  }

  /**
   * Get the in-progress (partial) candle for live price
   */
  getPartialCandle(pair: string, interval: string): PartialCandle | null {
    const bufferKey = `${pair}-${interval}`;
    return this.partialCandles.get(bufferKey) || null;
  }

  /**
   * Get last N closed candles (ascending by timestamp)
   */
  getCandles(pair: string, interval: string, limit: number = 100): Candle[] {
    const bufferKey = `${pair}-${interval}`;
    const buffer = this.buffers.get(bufferKey) || [];
    return buffer.slice(-limit);
  }

  /**
   * Check if the latest candle for a pair/interval is considered closed
   */
  isLatestCandleClosed(pair: string, interval: string): boolean {
    const latestCandle = this.getLatestCandle(pair, interval);
    if (!latestCandle) return false;

    const now = getCurrentTimestamp();
    return isCandleClosed(now, latestCandle.timestamp, interval);
  }

  /**
   * Register a callback fired each time a candle closes for this pair/interval
   */
  onCandleClosed(pair: string, interval: string, callback: (candle: Candle) => void): void {
    const bufferKey = `${pair}-${interval}`;
    this.closedCandleCallbacks.set(bufferKey, callback);
  }

  /**
   * Wait (promise) for the next candle close for a pair/interval
   */
  async waitForCandleClose(pair: string, interval: string, maxWait: number = 300000): Promise<Candle> {
    return new Promise((resolve, reject) => {
      const bufferKey = `${pair}-${interval}`;
      const originalCallback = this.closedCandleCallbacks.get(bufferKey);

      const wrappedCallback = (candle: Candle) => {
        if (originalCallback) {
          this.closedCandleCallbacks.set(bufferKey, originalCallback);
        } else {
          this.closedCandleCallbacks.delete(bufferKey);
        }
        clearTimeout(timeoutId);
        resolve(candle);
      };

      this.closedCandleCallbacks.set(bufferKey, wrappedCallback);

      const timeoutId = setTimeout(() => {
        if (originalCallback) {
          this.closedCandleCallbacks.set(bufferKey, originalCallback);
        } else {
          this.closedCandleCallbacks.delete(bufferKey);
        }
        reject(new Error(`Timeout waiting for candle close: ${bufferKey}`));
      }, maxWait);
    });
  }

  /**
   * Seed historical candles into a buffer.
   * Useful on startup so that indicators can be computed immediately.
   */
  seedCandles(pair: string, interval: string, candles: Candle[]): void {
    const bufferKey = `${pair}-${interval}`;
    this.buffers.set(bufferKey, candles.slice(-500));
    if (candles.length > 0) {
      this.lastProcessedTimestamps.set(bufferKey, candles[candles.length - 1].timestamp);
    }
    logger.info(`[CandleBuilder] Seeded ${candles.length} historical candles for ${bufferKey}`);
  }

  /**
   * Clear all internal state (useful for testing / restart)
   */
  clearBuffers(): void {
    this.buffers.clear();
    this.partialCandles.clear();
    this.lastProcessedTimestamps.clear();
    this.closedCandleCallbacks.clear();
  }

  /**
   * Diagnostic stats for monitoring
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {
      totalBuffers: this.buffers.size,
      bufferSizes: {},
      partialCandles: this.partialCandles.size,
    };

    this.buffers.forEach((buffer, key) => {
      stats.bufferSizes[key] = buffer.length;
    });

    return stats;
  }

  /**
   * Validate candle OHLCV integrity
   */
  private isValidCandle(candle: Candle): boolean {
    if (!candle.pair || !candle.interval) return false;
    if (candle.timestamp <= 0) return false;
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) return false;
    if (candle.high < candle.low) return false;
    if (candle.high < candle.open || candle.high < candle.close) return false;
    if (candle.low > candle.open || candle.low > candle.close) return false;
    if (candle.volume < 0) return false;
    return true;
  }

  /**
   * Check if all requested intervals have recent candles for a pair.
   * "Recent" means the latest candle timestamp is within 2× the interval window.
   */
  isSynchronized(pair: string, intervals: string[]): boolean {
    const now = Date.now();

    for (const interval of intervals) {
      const candle = this.getLatestCandle(pair, interval);
      if (!candle) return false;

      const intervalMs = INTERVALS_MS[interval as keyof typeof INTERVALS_MS] || 0;
      if (intervalMs === 0) continue;

      // Candle is stale if its open time is more than 2 intervals ago
      if (now - candle.timestamp > intervalMs * 2) {
        logger.debug(
          `[CandleBuilder] isSynchronized: ${pair} ${interval} candle is stale ` +
          `(age: ${now - candle.timestamp}ms, max: ${intervalMs * 2}ms)`
        );
        return false;
      }
    }

    return true;
  }
}

export const candleBuilder = new CandleBuilder();