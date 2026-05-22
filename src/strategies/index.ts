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
 *   (matches Pine: isFirst1m = ta.change(time("15")))
 * - Breakout of first 1m range (high + 0.1*rangeSize or low - 0.1*rangeSize)
 * - Dynamic stop loss based on ATR
 * - Two take profit targets: TP1=1R, TP2=RR multiple
 * - Only ONE trade per 15m range
 */
export class ETHStrategy {
  private config: ETHStrategyConfig;
  private strategyStates: Map<string, StrategyState> = new Map();
  private executionEngine: ExecutionEngine;
  private executionLock: Map<string, boolean> = new Map();

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

  private hasExecutionLock(key: string): boolean {
    return this.executionLock.get(key) || false;
  }

  private acquireExecutionLock(key: string): void {
    this.executionLock.set(key, true);
  }

  private releaseExecutionLock(key: string): void {
    this.executionLock.delete(key);
  }

  /**
   * Process new 5m candle — main strategy logic.
   *
   * @param candles1m   - 1-minute candles (range detection)
   * @param candles5m   - 5-minute candles (execution timeframe)
   * @param candles15m  - 15-minute candles (trend + volatility filters)
   * @param currentPrice - latest tick price
   */
  async processCandle(
    candles1m: Candle[],
    candles5m: Candle[],
    candles15m: Candle[],
    currentPrice: number
  ): Promise<Signal[]> {
    const signals: Signal[] = [];

    if (candles5m.length === 0 || candles15m.length === 0) {
      return signals;
    }

    const latestCandle5m  = candles5m[candles5m.length - 1];
    const latestCandle15m = candles15m[candles15m.length - 1];

    this.initializeState(this.config.pair, '15m');

    const stateKey = `${this.config.pair}-15m`;
    const state = this.strategyStates.get(stateKey)!;

    // ── New 15m block detection ────────────────────────────────────────────────
    if (latestCandle15m.timestamp !== state.rangeTimestamp) {
      this.resetFor15mCandle(latestCandle15m, candles1m);

      // Re-read state after reset (resetFor15mCandle mutates it)
      logger.info(
        `[ETHStrategy] New 15m candle @ ${new Date(latestCandle15m.timestamp).toISOString()} | ` +
        `Range: [${state.rangeLow.toFixed(2)}, ${state.rangeHigh.toFixed(2)}] ` +
        `Size: ${state.rangeSize.toFixed(4)}`
      );
    }

    // ── Indicators ────────────────────────────────────────────────────────────
    const indicators = {
      ema50_15m:  IndicatorCalculator.calculateEMA(candles15m, 50),
      ema200_15m: IndicatorCalculator.calculateEMA(candles15m, 200),
      atr_15m:    IndicatorCalculator.calculateATR(candles15m, 14),
      atrSma_15m: this.calculateATRSMA(candles15m, 14, 20),
    };

    // ── 1. Trend filter ───────────────────────────────────────────────────────
    const isBullTrend = indicators.ema50_15m > indicators.ema200_15m;
    const isBearTrend = indicators.ema50_15m < indicators.ema200_15m;

    if (!isBullTrend && !isBearTrend) {
      logger.debug('[ETHStrategy] No clear trend — waiting for confirmation');
      return signals;
    }

    // ── 2. Volatility filter ──────────────────────────────────────────────────
    // Guard: atrSma_15m returns 0 when there isn't enough candle history yet.
    // Treat 0 as "not enough data" rather than "low volatility" to avoid false blocks.
    if (indicators.atrSma_15m === 0) {
      logger.debug('[ETHStrategy] ATR SMA not ready — insufficient candle history');
      return signals;
    }

    const isVolatilityHigh = indicators.atr_15m > indicators.atrSma_15m;

    if (!isVolatilityHigh) {
      logger.debug(
        `[ETHStrategy] Volatility too low: ATR ${indicators.atr_15m.toFixed(2)} < ` +
        `ATR_SMA ${indicators.atrSma_15m.toFixed(2)}`
      );
      return signals;
    }

    logger.debug(
      `[ETHStrategy] Price ${currentPrice.toFixed(2)} | ` +
      `Range [${state.rangeLow.toFixed(2)}, ${state.rangeHigh.toFixed(2)}] | ` +
      `Trend: ${isBullTrend ? 'BULL' : 'BEAR'} ` +
      `(EMA50: ${indicators.ema50_15m.toFixed(2)} EMA200: ${indicators.ema200_15m.toFixed(2)}) | ` +
      `Vol: HIGH | TradeTaken: ${state.tradeTaken}`
    );

    // ── 3. Breakout detection & execution ─────────────────────────────────────
    if (!state.tradeTaken) {
      // Long: bull trend + price closed above range high + 10% buffer
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
      // Short: bear trend + price closed below range low - 10% buffer
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

    // ── 4. Exit management ────────────────────────────────────────────────────
    const openTrades = this.executionEngine.getOpenTradesForPair(this.config.pair);
    for (const trade of openTrades) {
      if (trade.status === 'OPEN') {
        if (RiskManager.isTakeProfitHit(currentPrice, trade.takeProfit1, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtTP1(trade.id, currentPrice);
          if (closedTrade) {
            signals.push({
              pair: this.config.pair,
              type: 'EXIT_TP1',
              price: currentPrice,
              timestamp: latestCandle5m.timestamp,
              confidence: 1.0,
              reason: `TP1 hit at ${currentPrice}`,
              relatedCandles: [
                { interval: '5m', timestamp: latestCandle5m.timestamp, candle: latestCandle5m },
              ],
            });
          }
        } else if (RiskManager.isStopLossHit(currentPrice, trade.stopLoss, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtExit(trade.id, currentPrice, 'SL_HIT');
          if (closedTrade) {
            signals.push({
              pair: this.config.pair,
              type: 'EXIT_SL',
              price: currentPrice,
              timestamp: latestCandle5m.timestamp,
              confidence: 1.0,
              reason: `Stop loss hit at ${currentPrice}`,
              relatedCandles: [
                { interval: '5m', timestamp: latestCandle5m.timestamp, candle: latestCandle5m },
              ],
            });
          }
        }
      } else if (trade.status === 'TP1_PARTIAL_CLOSE') {
        if (RiskManager.isTakeProfitHit(currentPrice, trade.takeProfit2, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtExit(trade.id, currentPrice, 'TP2_HIT');
          if (closedTrade) {
            signals.push({
              pair: this.config.pair,
              type: 'EXIT_TP2',
              price: currentPrice,
              timestamp: latestCandle5m.timestamp,
              confidence: 1.0,
              reason: `TP2 hit at ${currentPrice}`,
              relatedCandles: [
                { interval: '5m', timestamp: latestCandle5m.timestamp, candle: latestCandle5m },
              ],
            });
          }
        } else if (RiskManager.isStopLossHit(currentPrice, trade.stopLoss, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtExit(trade.id, currentPrice, 'SL_HIT');
          if (closedTrade) {
            signals.push({
              pair: this.config.pair,
              type: 'EXIT_SL',
              price: currentPrice,
              timestamp: latestCandle5m.timestamp,
              confidence: 1.0,
              reason: `Stop loss hit at ${currentPrice}`,
              relatedCandles: [
                { interval: '5m', timestamp: latestCandle5m.timestamp, candle: latestCandle5m },
              ],
            });
          }
        }
      }
    }

    return signals;
  }

  /**
   * Reset state for a new 15m candle.
   *
   * Range is set from the FIRST 1m candle that falls within this 15m block,
   * matching Pine: isFirst1m = ta.change(time("15")) → rangeHigh := oneMinHigh
   *
   * Fallback: if no 1m candle is available yet (block just opened),
   * use the 15m candle's own OHLC as a temporary range.
   * This avoids silently swallowing the missing-candle case.
   */
  private resetFor15mCandle(candle15m: Candle, candles1m: Candle[]): void {
    const stateKey = `${this.config.pair}-15m`;
    const state = this.strategyStates.get(stateKey)!;

    const firstCandle1m = this.getFirst1mCandleOfRange(candle15m, candles1m);

    if (firstCandle1m) {
      state.rangeHigh = firstCandle1m.high;
      state.rangeLow  = firstCandle1m.low;
      logger.debug(
        `[ETHStrategy] Range from 1m candle @ ` +
        `${new Date(firstCandle1m.timestamp).toISOString()}: ` +
        `[${state.rangeLow}, ${state.rangeHigh}]`
      );
    } else {
      // No 1m candle yet — 15m block just opened this tick.
      // Use 15m candle OHLC as a conservative temporary range.
      // tradeTaken remains false so range will be refined on next tick
      // once the first 1m candle closes.
      state.rangeHigh = candle15m.high;
      state.rangeLow  = candle15m.low;
      logger.debug(
        `[ETHStrategy] No 1m candle found for new 15m block — ` +
        `using 15m candle range as fallback: [${state.rangeLow}, ${state.rangeHigh}]`
      );
    }

    state.rangeSize      = state.rangeHigh - state.rangeLow;
    state.rangeTimestamp = candle15m.timestamp;
    state.tradeTaken     = false;
    state.lastSignal     = undefined;
  }

  /**
   * Find the first 1m candle whose timestamp falls within the given 15m block.
   */
  private getFirst1mCandleOfRange(candle15m: Candle, candles1m: Candle[]): Candle | null {
    const startTime = candle15m.timestamp;
    const endTime   = candle15m.timestamp + 15 * 60 * 1000;

    for (const c of candles1m) {
      if (c.timestamp >= startTime && c.timestamp < endTime) {
        return c;
      }
    }

    return null;
  }

  /**
   * Execute long breakout trade.
   * Uses ATR-based dynamic stop loss (matches Pine: longSL = rangeLow - atr * atrMult).
   */
  private executeLongBreakout(price: number, atr: number, timestamp: number): Signal | null {
    const lockKey = `${this.config.pair}-LONG-${timestamp}`;

    if (this.hasExecutionLock(lockKey)) {
      logger.debug(`[ETHStrategy] Long execution lock active for ${lockKey}`);
      return null;
    }

    this.acquireExecutionLock(lockKey);

    try {
      const stopLossPrice = RiskManager.calculateLongStopLoss(price, atr, this.config.atrMultiplier);
      const quantity = RiskManager.calculatePositionSize(
        this.executionEngine.getTotalEquity(),
        price,
        stopLossPrice,
        this.config.riskPercent
      );

      if (quantity === 0) {
        logger.warn('[ETHStrategy] Position size too small for long trade');
        return null;
      }

      const tp1Price = RiskManager.calculateTP1(price, atr, this.config.atrMultiplier, 'LONG');
      const tp2Price = RiskManager.calculateTP2(price, atr, this.config.atrMultiplier, this.config.riskRewardRatio, 'LONG');

      const trade = this.executionEngine.openLongTrade(
        this.config.pair,
        price,
        quantity,
        stopLossPrice,
        tp1Price,
        tp2Price
      );

      if (!trade) {
        logger.warn(`[ETHStrategy] LONG trade failed to execute at ${price.toFixed(2)}`);
        return null;
      }

      logger.info(
        `[ETHStrategy] ✅ LONG EXECUTED: Price ${price.toFixed(2)} | ` +
        `Qty: ${quantity.toFixed(6)} | SL: ${stopLossPrice.toFixed(2)} | ` +
        `TP1: ${tp1Price.toFixed(2)} | TP2: ${tp2Price.toFixed(2)}`
      );

      return {
        pair: this.config.pair,
        type: 'ENTRY_LONG',
        price: formatPrice(price, PRECISION.PRICE),
        timestamp,
        confidence: 0.95,
        reason: `Long breakout above range high at ${price}`,
        relatedCandles: [],
      };
    } finally {
      setTimeout(() => this.releaseExecutionLock(lockKey), 1000);
    }
  }

  /**
   * Execute short breakout trade.
   * Uses ATR-based dynamic stop loss (matches Pine: shortSL = rangeHigh + atr * atrMult).
   */
  private executeShortBreakout(price: number, atr: number, timestamp: number): Signal | null {
    const lockKey = `${this.config.pair}-SHORT-${timestamp}`;

    if (this.hasExecutionLock(lockKey)) {
      logger.debug(`[ETHStrategy] Short execution lock active for ${lockKey}`);
      return null;
    }

    this.acquireExecutionLock(lockKey);

    try {
      const stopLossPrice = RiskManager.calculateShortStopLoss(price, atr, this.config.atrMultiplier);
      const quantity = RiskManager.calculatePositionSize(
        this.executionEngine.getTotalEquity(),
        price,
        stopLossPrice,
        this.config.riskPercent
      );

      if (quantity === 0) {
        logger.warn('[ETHStrategy] Position size too small for short trade');
        return null;
      }

      const tp1Price = RiskManager.calculateTP1(price, atr, this.config.atrMultiplier, 'SHORT');
      const tp2Price = RiskManager.calculateTP2(price, atr, this.config.atrMultiplier, this.config.riskRewardRatio, 'SHORT');

      const trade = this.executionEngine.openShortTrade(
        this.config.pair,
        price,
        quantity,
        stopLossPrice,
        tp1Price,
        tp2Price
      );

      if (!trade) {
        logger.warn(`[ETHStrategy] SHORT trade failed to execute at ${price.toFixed(2)}`);
        return null;
      }

      logger.info(
        `[ETHStrategy] ✅ SHORT EXECUTED: Price ${price.toFixed(2)} | ` +
        `Qty: ${quantity.toFixed(6)} | SL: ${stopLossPrice.toFixed(2)} | ` +
        `TP1: ${tp1Price.toFixed(2)} | TP2: ${tp2Price.toFixed(2)}`
      );

      return {
        pair: this.config.pair,
        type: 'ENTRY_SHORT',
        price: formatPrice(price, PRECISION.PRICE),
        timestamp,
        confidence: 0.95,
        reason: `Short breakout below range low at ${price}`,
        relatedCandles: [],
      };
    } finally {
      setTimeout(() => this.releaseExecutionLock(lockKey), 1000);
    }
  }

  /**
   * Calculate ATR SMA (simple moving average of ATR values).
   * Returns 0 if there is insufficient candle history.
   *
   * Note: O(n²) loop — acceptable for typical candle buffer sizes (~200 candles).
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
   * Reset strategy (for testing/restart)
   */
  reset(): void {
    this.strategyStates.clear();
    this.executionLock.clear();
    logger.info('[ETHStrategy] Strategy reset');
  }
}

export * from './btc-strategy';