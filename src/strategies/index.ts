import { Candle, Signal, StrategyState } from '@/types';
import { IndicatorCalculator } from '@/indicators';
import { RiskManager } from '@/risk';
import { ExecutionEngine } from '@/execution';
import { SIGNAL_TYPES, PRECISION } from '@/constants';
import { generateId, formatPrice } from '@/utils';
import logger from '@/logging';

export interface ETHStrategyConfig {
  pair: string;
  riskPercent: number;
  riskRewardRatio: number;
  atrMultiplier: number;
}

/**
 * ETH Trading Strategy
 * Execution timeframe: 5 minute candles
 * Analysis timeframes: 1m, 5m, 15m
 * 
 * Rules:
 * - 15m EMA Trend Filter (EMA50 > EMA200 = Bull, < = Bear)
 * - 15m ATR > ATR_SMA for volatility confirmation
 * - First 1m range detection at 15m candle open
 * - Breakout of first 1m range (high + 0.1*rangeSize or low - 0.1*rangeSize)
 * - Dynamic stop loss based on ATR
 * - Two take profit targets: TP1=1R, TP2=RR multiple
 * - Only ONE trade per 15m range
 */
export class ETHStrategy {
  private config: ETHStrategyConfig;
  private strategyStates: Map<string, StrategyState> = new Map();
  private executionEngine: ExecutionEngine;
  private executionLock: Map<string, boolean> = new Map(); // Prevent duplicate executions

  constructor(config: ETHStrategyConfig, executionEngine: ExecutionEngine) {
    this.config = config;
    this.executionEngine = executionEngine;
  }

  /**
   * Initialize strategy state for a pair
   */
  initializeState(pair: string, interval: string): void {
    const stateKey = `${pair}-${interval}`;
    if (!this.strategyStates.has(stateKey)) {
      this.strategyStates.set(stateKey, {
        pair,
        interval,
        rangeHigh: 0,
        rangeLow: 0,
        rangeSize: 0,
        rangeTimestamp: 0,
        tradeTaken: false,
        lastCandleTimestamp: 0,
      });
    }
  }

  /**
   * Get strategy state
   */
  getState(pair: string, interval: string): StrategyState | null {
    const stateKey = `${pair}-${interval}`;
    return this.strategyStates.get(stateKey) || null;
  }

  /**
   * Get execution lock status
   */
  private hasExecutionLock(key: string): boolean {
    return this.executionLock.get(key) || false;
  }

  /**
   * Acquire execution lock
   */
  private acquireExecutionLock(key: string): void {
    this.executionLock.set(key, true);
  }

  /**
   * Release execution lock
   */
  private releaseExecutionLock(key: string): void {
    this.executionLock.delete(key);
  }

  /**
   * Process new 5m candle - main strategy logic
   */
  async processCandle(
    candles1m: Candle[],
    candles5m: Candle[],
    candles15m: Candle[],
    currentPrice: number
  ): Promise<Signal[]> {
    const signals: Signal[] = [];

    // Validate we have minimum data
    if (candles5m.length === 0 || candles15m.length === 0) {
      return signals;
    }

    const latestCandle5m = candles5m[candles5m.length - 1];
    const latestCandle15m = candles15m[candles15m.length - 1];

    // Initialize state if needed
    this.initializeState(this.config.pair, '15m');

    const stateKey = `${this.config.pair}-15m`;
    const state = this.strategyStates.get(stateKey)!;

    // Check if we're in a new 15m candle
    if (latestCandle15m.timestamp !== state.rangeTimestamp) {
      // New 15m candle - reset range and trade taken flag
      this.resetFor15mCandle(latestCandle15m, candles1m);
      logger.info(
        `New 15m candle detected. Range: ${state.rangeHigh} - ${state.rangeLow}, Size: ${state.rangeSize}`
      );
    }

    // Calculate indicators from latest candles
    const indicators = {
      ema50_15m: IndicatorCalculator.calculateEMA(candles15m, 50),
      ema200_15m: IndicatorCalculator.calculateEMA(candles15m, 200),
      atr_15m: IndicatorCalculator.calculateATR(candles15m, 14),
      atrSma_15m: this.calculateATRSMA(candles15m, 14, 20),
    };

    // 1. Trend Filter Check
    const isBullTrend = indicators.ema50_15m > indicators.ema200_15m;
    const isBearTrend = indicators.ema50_15m < indicators.ema200_15m;

    if (!isBullTrend && !isBearTrend) {
      logger.debug('No clear trend - waiting for trend confirmation');
      return signals;
    }

    // 2. Volatility Filter Check
    const isVolatilityHigh = indicators.atr_15m > indicators.atrSma_15m;

    if (!isVolatilityHigh) {
      logger.debug(`Volatility too low: ATR ${indicators.atr_15m} < ATR_SMA ${indicators.atrSma_15m}`);
      return signals;
    }

    // 3. Check for breakout and execute trades
    if (!state.tradeTaken) {
      // Long breakout
      if (isBullTrend && currentPrice > state.rangeHigh + state.rangeSize * 0.1) {
        const longSignal = this.executeLongBreakout(
          currentPrice,
          indicators.atr_15m,
          latestCandle5m.timestamp
        );
        if (longSignal) {
          signals.push(longSignal);
          state.tradeTaken = true;
          state.lastSignal = longSignal;
        }
      }
      // Short breakout
      else if (isBearTrend && currentPrice < state.rangeLow - state.rangeSize * 0.1) {
        const shortSignal = this.executeShortBreakout(
          currentPrice,
          indicators.atr_15m,
          latestCandle5m.timestamp
        );
        if (shortSignal) {
          signals.push(shortSignal);
          state.tradeTaken = true;
          state.lastSignal = shortSignal;
        }
      }
    }

    // 4. Check for exit signals on open trades
    const openTrades = this.executionEngine.getOpenTradesForPair(this.config.pair);
    for (const trade of openTrades) {
      // Check take profit and stop loss
      if (trade.status === 'OPEN') {
        if (RiskManager.isTakeProfitHit(currentPrice, trade.takeProfit1, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtTP1(trade.id, currentPrice);
          if (closedTrade) {
            const exitSignal: Signal = {
              pair: this.config.pair,
              type: 'EXIT_TP1',
              price: currentPrice,
              timestamp: latestCandle5m.timestamp,
              confidence: 1.0,
              reason: `TP1 hit at ${currentPrice}`,
              relatedCandles: [
                {
                  interval: '5m',
                  timestamp: latestCandle5m.timestamp,
                  candle: latestCandle5m,
                },
              ],
            };
            signals.push(exitSignal);
          }
        } else if (RiskManager.isStopLossHit(currentPrice, trade.stopLoss, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtExit(trade.id, currentPrice, 'SL_HIT');
          if (closedTrade) {
            const exitSignal: Signal = {
              pair: this.config.pair,
              type: 'EXIT_SL',
              price: currentPrice,
              timestamp: latestCandle5m.timestamp,
              confidence: 1.0,
              reason: `Stop loss hit at ${currentPrice}`,
              relatedCandles: [
                {
                  interval: '5m',
                  timestamp: latestCandle5m.timestamp,
                  candle: latestCandle5m,
                },
              ],
            };
            signals.push(exitSignal);
          }
        }
      } else if (trade.status === 'TP1_PARTIAL_CLOSE') {
        // Check TP2 for partial close
        if (RiskManager.isTakeProfitHit(currentPrice, trade.takeProfit2, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtExit(trade.id, currentPrice, 'TP2_HIT');
          if (closedTrade) {
            const exitSignal: Signal = {
              pair: this.config.pair,
              type: 'EXIT_TP2',
              price: currentPrice,
              timestamp: latestCandle5m.timestamp,
              confidence: 1.0,
              reason: `TP2 hit at ${currentPrice}`,
              relatedCandles: [
                {
                  interval: '5m',
                  timestamp: latestCandle5m.timestamp,
                  candle: latestCandle5m,
                },
              ],
            };
            signals.push(exitSignal);
          }
        } else if (RiskManager.isStopLossHit(currentPrice, trade.stopLoss, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtExit(trade.id, currentPrice, 'SL_HIT');
          if (closedTrade) {
            const exitSignal: Signal = {
              pair: this.config.pair,
              type: 'EXIT_SL',
              price: currentPrice,
              timestamp: latestCandle5m.timestamp,
              confidence: 1.0,
              reason: `Stop loss hit at ${currentPrice}`,
              relatedCandles: [
                {
                  interval: '5m',
                  timestamp: latestCandle5m.timestamp,
                  candle: latestCandle5m,
                },
              ],
            };
            signals.push(exitSignal);
          }
        }
      }
    }

    return signals;
  }

  /**
   * Reset state for new 15m candle
   */
  private resetFor15mCandle(candle15m: Candle, candles1m: Candle[]): void {
    const stateKey = `${this.config.pair}-15m`;
    const state = this.strategyStates.get(stateKey)!;

    // Get first 1m candle of this 15m period
    const firstCandle1m = this.getFirst1mCandleOfRange(candle15m, candles1m);

    if (firstCandle1m) {
      state.rangeHigh = firstCandle1m.high;
      state.rangeLow = firstCandle1m.low;
      state.rangeSize = state.rangeHigh - state.rangeLow;
    } else {
      state.rangeHigh = candle15m.high;
      state.rangeLow = candle15m.low;
      state.rangeSize = state.rangeHigh - state.rangeLow;
    }

    state.rangeTimestamp = candle15m.timestamp;
    state.tradeTaken = false;
    state.lastSignal = undefined;
  }

  /**
   * Get the first 1m candle of a 15m period
   */
  private getFirst1mCandleOfRange(candle15m: Candle, candles1m: Candle[]): Candle | null {
    // Find candles that belong to this 15m candle
    const startTime = candle15m.timestamp;
    const endTime = candle15m.timestamp + 15 * 60 * 1000;

    for (const c of candles1m) {
      if (c.timestamp >= startTime && c.timestamp < endTime) {
        return c;
      }
    }

    return null;
  }

  /**
   * Execute long breakout trade
   */
  private executeLongBreakout(price: number, atr: number, timestamp: number): Signal | null {
    const lockKey = `${this.config.pair}-LONG-${timestamp}`;

    if (this.hasExecutionLock(lockKey)) {
      return null; // Already executed
    }

    this.acquireExecutionLock(lockKey);

    try {
      // Calculate position sizing
      const stopLossPrice = RiskManager.calculateLongStopLoss(price, atr, this.config.atrMultiplier);
      const quantity = RiskManager.calculatePositionSize(
        this.executionEngine.getTotalEquity(),
        price,
        stopLossPrice,
        this.config.riskPercent
      );

      if (quantity === 0) {
        logger.warn('Position size too small for long trade');
        return null;
      }

      // Calculate take profits
      const tp1Price = RiskManager.calculateTP1(price, atr, this.config.atrMultiplier, 'LONG');
      const tp2Price = RiskManager.calculateTP2(price, atr, this.config.atrMultiplier, this.config.riskRewardRatio, 'LONG');

      // Execute trade
      const trade = this.executionEngine.openLongTrade(
        this.config.pair,
        price,
        quantity,
        stopLossPrice,
        tp1Price,
        tp2Price
      );

      if (!trade) {
        return null;
      }

      // Create signal
      const signal: Signal = {
        pair: this.config.pair,
        type: 'ENTRY_LONG',
        price: formatPrice(price, PRECISION.PRICE),
        timestamp,
        confidence: 0.95,
        reason: `Long breakout above range high at ${price}`,
        relatedCandles: [],
      };

      return signal;
    } finally {
      // Keep lock for a short time to prevent duplicate execution
      setTimeout(() => this.releaseExecutionLock(lockKey), 1000);
    }
  }

  /**
   * Execute short breakout trade
   */
  private executeShortBreakout(price: number, atr: number, timestamp: number): Signal | null {
    const lockKey = `${this.config.pair}-SHORT-${timestamp}`;

    if (this.hasExecutionLock(lockKey)) {
      return null; // Already executed
    }

    this.acquireExecutionLock(lockKey);

    try {
      // Calculate position sizing
      const stopLossPrice = RiskManager.calculateShortStopLoss(price, atr, this.config.atrMultiplier);
      const quantity = RiskManager.calculatePositionSize(
        this.executionEngine.getTotalEquity(),
        price,
        stopLossPrice,
        this.config.riskPercent
      );

      if (quantity === 0) {
        logger.warn('Position size too small for short trade');
        return null;
      }

      // Calculate take profits
      const tp1Price = RiskManager.calculateTP1(price, atr, this.config.atrMultiplier, 'SHORT');
      const tp2Price = RiskManager.calculateTP2(price, atr, this.config.atrMultiplier, this.config.riskRewardRatio, 'SHORT');

      // Execute trade
      const trade = this.executionEngine.openShortTrade(
        this.config.pair,
        price,
        quantity,
        stopLossPrice,
        tp1Price,
        tp2Price
      );

      if (!trade) {
        return null;
      }

      // Create signal
      const signal: Signal = {
        pair: this.config.pair,
        type: 'ENTRY_SHORT',
        price: formatPrice(price, PRECISION.PRICE),
        timestamp,
        confidence: 0.95,
        reason: `Short breakout below range low at ${price}`,
        relatedCandles: [],
      };

      return signal;
    } finally {
      // Keep lock for a short time to prevent duplicate execution
      setTimeout(() => this.releaseExecutionLock(lockKey), 1000);
    }
  }

  /**
   * Calculate ATR SMA (simple moving average of ATR)
   */
  private calculateATRSMA(candles: Candle[], atrPeriod: number, smaPeriod: number): number {
    if (candles.length < atrPeriod + smaPeriod) return 0;

    const atrValues: number[] = [];

    for (let i = atrPeriod; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const atr = IndicatorCalculator.calculateATR(slice, atrPeriod);
      atrValues.push(atr);
    }

    if (atrValues.length < smaPeriod) return 0;

    const sum = atrValues.slice(-smaPeriod).reduce((a, b) => a + b, 0);
    return sum / smaPeriod;
  }

  /**
   * Reset strategy (for testing/reset)
   */
  reset(): void {
    this.strategyStates.clear();
    this.executionLock.clear();
    logger.info('Strategy reset');
  }
}

export * from './btc-strategy';

