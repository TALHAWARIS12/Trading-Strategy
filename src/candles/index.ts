import { Candle, PartialCandle } from '@/types';
import { getCandleOpenTime, getCandleCloseTime, isCandleClosed, getCurrentTimestamp } from '@/utils';
import { INTERVALS_MS } from '@/constants';
import logger from '@/logging';

export interface KlineData {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  k: {
    t: number; // Kline start time
    T: number; // Kline close time
    s: string; // Symbol
    i: string; // Interval
    f: number; // First trade ID
    L: number; // Last trade ID
    o: string; // Open price
    c: string; // Close price
    h: string; // High price
    l: string; // Low price
    v: string; // Base asset volume
    n: number; // Number of trades
    x: boolean; // Is this kline closed?
    q: string; // Quote asset volume
    V: string; // Taker buy base asset volume
    Q: string; // Taker buy quote asset volume
    B: string; // Ignore
  };
}

export class CandleBuilder {
  private buffers: Map<string, Candle[]> = new Map(); // key: pair-interval
  private partialCandles: Map<string, PartialCandle> = new Map(); // key: pair-interval
  private lastProcessedTimestamps: Map<string, number> = new Map(); // key: pair-interval
  private closedCandleCallbacks: Map<string, (candle: Candle) => void> = new Map();

  /**
   * Process kline data from WebSocket
   */
  processKline(data: KlineData): Candle | null {
    const { s: pair, k } = data;
    const interval = k.i;
    const bufferKey = `${pair}-${interval}`;

    const candleData = {
      pair,
      interval,
      timestamp: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      isClosed: k.x,
    };

    // Validate candle data
    if (!this.isValidCandle(candleData)) {
      logger.warn(`Invalid candle data received: ${JSON.stringify(candleData)}`);
      return null;
    }

    // Store partial candle for in-progress data
    if (!k.x) {
      this.partialCandles.set(bufferKey, {
        pair: candleData.pair,
        interval: candleData.interval,
        timestamp: candleData.timestamp,
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        volume: candleData.volume,
        isComplete: candleData.isClosed,
      });
      return null;
    }

    // Process closed candle
    return this.processClosedCandle(candleData);
  }

  /**
   * Process a closed candle
   */
  private processClosedCandle(candleData: Candle): Candle {
    const bufferKey = `${candleData.pair}-${candleData.interval}`;
    const lastTimestamp = this.lastProcessedTimestamps.get(bufferKey) || 0;

    // Detect missing candles
    const intervalMs = INTERVALS_MS[candleData.interval as keyof typeof INTERVALS_MS] || 0;
    if (lastTimestamp > 0 && candleData.timestamp - lastTimestamp > intervalMs * 1.5) {
      logger.warn(
        `Missing candle(s) detected for ${bufferKey}: gap of ${candleData.timestamp - lastTimestamp}ms`
      );
    }

    // Check for out-of-order candles
    if (lastTimestamp > 0 && candleData.timestamp < lastTimestamp) {
      logger.warn(`Out-of-order candle received for ${bufferKey}`);
      return candleData;
    }

    this.lastProcessedTimestamps.set(bufferKey, candleData.timestamp);

    // Add to buffer
    const buffer = this.buffers.get(bufferKey) || [];
    buffer.push(candleData);

    // Keep only last N candles to avoid memory bloat
    const maxBufferSize = 500;
    if (buffer.length > maxBufferSize) {
      buffer.shift();
    }

    this.buffers.set(bufferKey, buffer);

    // Remove from partial candles
    this.partialCandles.delete(bufferKey);

    // Trigger callback if registered
    const callback = this.closedCandleCallbacks.get(bufferKey);
    if (callback) {
      callback(candleData);
    }

    return candleData;
  }

  /**
   * Get the latest closed candle
   */
  getLatestCandle(pair: string, interval: string): Candle | null {
    const bufferKey = `${pair}-${interval}`;
    const buffer = this.buffers.get(bufferKey);
    return buffer && buffer.length > 0 ? buffer[buffer.length - 1] : null;
  }

  /**
   * Get the partial/in-progress candle
   */
  getPartialCandle(pair: string, interval: string): PartialCandle | null {
    const bufferKey = `${pair}-${interval}`;
    return this.partialCandles.get(bufferKey) || null;
  }

  /**
   * Get last N candles
   */
  getCandles(pair: string, interval: string, limit: number = 100): Candle[] {
    const bufferKey = `${pair}-${interval}`;
    const buffer = this.buffers.get(bufferKey) || [];
    return buffer.slice(-limit);
  }

  /**
   * Check if the latest candle is closed
   */
  isLatestCandleClosed(pair: string, interval: string): boolean {
    const bufferKey = `${pair}-${interval}`;
    const latestCandle = this.getLatestCandle(pair, interval);
    if (!latestCandle) return false;

    const now = getCurrentTimestamp();
    return isCandleClosed(now, latestCandle.timestamp, interval);
  }

  /**
   * Register callback for closed candles
   */
  onCandleClosed(pair: string, interval: string, callback: (candle: Candle) => void): void {
    const bufferKey = `${pair}-${interval}`;
    this.closedCandleCallbacks.set(bufferKey, callback);
  }

  /**
   * Wait for next candle close
   */
  async waitForCandleClose(pair: string, interval: string, maxWait: number = 300000): Promise<Candle> {
    return new Promise((resolve, reject) => {
      const bufferKey = `${pair}-${interval}`;
      const originalCallback = this.closedCandleCallbacks.get(bufferKey);

      const wrappedCallback = (candle: Candle) => {
        // Restore original callback
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
        // Restore original callback
        if (originalCallback) {
          this.closedCandleCallbacks.set(bufferKey, originalCallback);
        } else {
          this.closedCandleCallbacks.delete(bufferKey);
        }

        reject(new Error(`Timeout waiting for candle close for ${bufferKey}`));
      }, maxWait);
    });
  }

  /**
   * Clear all buffers
   */
  clearBuffers(): void {
    this.buffers.clear();
    this.partialCandles.clear();
    this.lastProcessedTimestamps.clear();
    this.closedCandleCallbacks.clear();
  }

  /**
   * Get buffer statistics
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
   * Validate candle data
   */
  private isValidCandle(candle: Candle): boolean {
    if (!candle.pair || !candle.interval) return false;
    if (candle.timestamp <= 0) return false;
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0)
      return false;
    if (candle.high < candle.low) return false;
    if (candle.high < candle.open || candle.high < candle.close) return false;
    if (candle.low > candle.open || candle.low > candle.close) return false;
    if (candle.volume < 0) return false;

    return true;
  }

  /**
   * Synchronize intervals - check if all related intervals have closed candles at the right time
   */
  isSynchronized(pair: string, intervals: string[]): boolean {
    let referenceTimestamp: number | null = null;

    for (const interval of intervals) {
      const candle = this.getLatestCandle(pair, interval);
      if (!candle) return false;

      if (!referenceTimestamp) {
        referenceTimestamp = candle.timestamp;
      } else {
        // Check if all candles have compatible timestamps
        const openTime = getCandleOpenTime(Date.now(), interval);
        if (candle.timestamp !== referenceTimestamp) {
          // Timestamps don't align exactly, but check if they're at compatible intervals
          const intervalMs = INTERVALS_MS[interval as keyof typeof INTERVALS_MS] || 0;
          if (Math.abs(candle.timestamp - referenceTimestamp) > intervalMs) {
            return false;
          }
        }
      }
    }

    return true;
  }
}

export const candleBuilder = new CandleBuilder();
