import { Candle, Signal, StrategyConfig, Trade } from '@/types';
import { IndicatorCalculator } from '@/indicators';
import { RiskManager } from '@/risk';
import { ExecutionEngine } from '@/execution';
import { PRECISION } from '@/constants';
import { formatPrice } from '@/utils';
import logger from '@/logging';

export interface BTCStrategyConfig {
  pair: string;
  riskPercent: number;
  riskRewardRatio: number;
}

/**
 * BTC Micro Range Sweep Strategy
 *
 * Pine Script Logic Ported to TypeScript:
 * - Detects first 1m candle of 15m block (Pine: isFirst1m = ta.change(time("15")))
 * - Captures range high/low from that 1m candle
 * - Trades breakout at exact range boundaries (no offset)
 * - Position sized at 1% risk
 * - Stop loss at range low (long) / range high (short)
 * - Take profit at 2:1 risk/reward
 *
 * Original Pine Script by user
 * Ported to Node.js/TypeScript for live trading
 */
export class BTCStrategy {
  private config: BTCStrategyConfig;
  private executionEngine: ExecutionEngine;
  private state: {
    last15mTime: number;
    lastCandleTimestamp: number;
    rangeHigh: number | null;
    rangeLow: number | null;
    tradeTaken: boolean;
    signalLocked: boolean;
    lockTimeout: NodeJS.Timeout | null;
  };

  constructor(config: BTCStrategyConfig, executionEngine: ExecutionEngine) {
    this.config = config;
    this.executionEngine = executionEngine;
    this.state = {
      last15mTime: 0,
      lastCandleTimestamp: 0,
      rangeHigh: null,
      rangeLow: null,
      tradeTaken: false,
      signalLocked: false,
      lockTimeout: null,
    };

    logger.info(`[BTCStrategy] Initialized for ${config.pair}`);
  }

  /**
   * Process new candle tick and detect 15m range boundaries.
   * Range is set from the FIRST 1m candle of each 15m block,
   * matching Pine Script: isFirst1m = ta.change(time("15"))
   *
   * @param candles1m  - 1-minute candles (used for range detection)
   * @param candles15m - 15-minute candles (used for block boundary detection)
   * @param currentPrice - latest tick price
   */
  async processCandle(
    candles1m: Candle[],
    candles15m: Candle[],
    currentPrice: number
  ): Promise<Signal[]> {
    const signals: Signal[] = [];

    // Validation
    if (!candles1m || candles1m.length === 0) {
      return signals;
    }

    if (!candles15m || candles15m.length < 2) {
      return signals;
    }

    // Get current 15m candle (the one being formed)
    const current15m = candles15m[candles15m.length - 1];

    // Detect if we crossed into a new 15m block
    const is15mChanged = current15m.timestamp !== this.state.last15mTime;

    if (is15mChanged) {
      // We've entered a new 15m block
      this.state.last15mTime = current15m.timestamp;
      this.state.tradeTaken = false;

      // Find the FIRST 1m candle that belongs to this 15m block.
      // Matches Pine: isFirst1m = ta.change(time("15")) → rangeHigh := oneMinHigh
      const blockStart = current15m.timestamp;
      const blockEnd   = blockStart + 15 * 60 * 1000;

      const first1m = candles1m.find(
        c => c.timestamp >= blockStart && c.timestamp < blockEnd
      );

      if (first1m) {
        this.state.rangeHigh = first1m.high;
        this.state.rangeLow  = first1m.low;
        logger.debug(
          `[BTCStrategy] New 15m block @ ${new Date(blockStart).toISOString()}: ` +
          `Range [${this.state.rangeLow}, ${this.state.rangeHigh}] ` +
          `from 1m candle @ ${new Date(first1m.timestamp).toISOString()}`
        );
      } else {
        // First 1m candle of this block hasn't closed yet — wait
        this.state.rangeHigh = null;
        this.state.rangeLow  = null;
        logger.debug(
          `[BTCStrategy] New 15m block @ ${new Date(blockStart).toISOString()}: ` +
          `waiting for first 1m candle to close`
        );
      }
    }

    // Only process if we have a valid range
    if (this.state.rangeHigh === null || this.state.rangeLow === null) {
      logger.debug(
        `[BTCStrategy] No range set yet. Current price: ${currentPrice.toFixed(2)}`
      );
      return signals;
    }

    // Only evaluate breakout on a new 1m candle close (not every tick).
    // Matches Pine: breakout evaluated on each bar close.
    const latestCandle1m = candles1m[candles1m.length - 1];
    const isNewCandle = latestCandle1m.timestamp !== this.state.lastCandleTimestamp;

    if (!isNewCandle) {
      return signals;
    }

    this.state.lastCandleTimestamp = latestCandle1m.timestamp;

    // Use candle close price for breakout check, matching Pine's close-based logic
    const closePrice = latestCandle1m.close;

    // Check for breakout — exact range boundaries, no offset (matches Pine Script)
    const longBreakout  = !this.state.tradeTaken && closePrice > this.state.rangeHigh;
    const shortBreakout = !this.state.tradeTaken && closePrice < this.state.rangeLow;

    logger.info(
      `[BTCStrategy] Candle close ${closePrice.toFixed(2)} vs Range ` +
      `[${this.state.rangeLow.toFixed(2)}, ${this.state.rangeHigh.toFixed(2)}] | ` +
      `Long=${longBreakout}, Short=${shortBreakout}, ` +
      `TradeTaken=${this.state.tradeTaken}, Locked=${this.state.signalLocked}`
    );

    // ── Long breakout ──────────────────────────────────────────────────────────
    if (longBreakout && !this.state.signalLocked) {
      // Risk = distance from entry to stop (range low), matching Pine: longRisk = close - longSL
      const riskPrice    = closePrice - this.state.rangeLow;

      if (riskPrice > 0) {
        const stopLossPrice = this.state.rangeLow;
        const quantity = RiskManager.calculatePositionSize(
          this.executionEngine.getTotalEquity(),
          closePrice,
          stopLossPrice,
          this.config.riskPercent
        );

        if (quantity > 0) {
          const tp1Price = closePrice + riskPrice * 1.0;
          const tp2Price = closePrice + riskPrice * this.config.riskRewardRatio;

          const trade = this.executionEngine.openLongTrade(
            this.config.pair,
            closePrice,
            quantity,
            stopLossPrice,
            tp1Price,
            tp2Price
          );

          if (trade) {
            signals.push({
              type: 'ENTRY_LONG',
              pair: this.config.pair,
              timestamp: Date.now(),
              price: formatPrice(closePrice, PRECISION.PRICE),
              stopLoss: stopLossPrice,
              takeProfit1: tp1Price,
              takeProfit2: tp2Price,
              reason: `Breakout above range high ${this.state.rangeHigh.toFixed(2)}`,
              confidence: 0.8,
              relatedCandles: [],
            });

            this.state.tradeTaken = true;
            this._lockExecution();

            logger.info(
              `[BTCStrategy] ✅ LONG EXECUTED: Close ${closePrice.toFixed(2)} > ` +
              `RangeHigh ${this.state.rangeHigh.toFixed(2)} | ` +
              `Qty: ${quantity.toFixed(6)} | SL: ${stopLossPrice.toFixed(2)} | ` +
              `TP1: ${tp1Price.toFixed(2)} | TP2: ${tp2Price.toFixed(2)}`
            );
          } else {
            // Trade failed at execution engine — do NOT lock or set tradeTaken
            // so the next candle close can retry
            logger.warn(
              `[BTCStrategy] LONG trade failed to execute at ${closePrice.toFixed(2)}`
            );
          }
        } else {
          logger.warn('[BTCStrategy] Position size too small for long trade');
        }
      }
    }

    // ── Short breakout ─────────────────────────────────────────────────────────
    if (shortBreakout && !this.state.signalLocked) {
      // Risk = distance from stop (range high) to entry, matching Pine: shortRisk = shortSL - close
      const riskPrice = this.state.rangeHigh - closePrice;

      if (riskPrice > 0) {
        const stopLossPrice = this.state.rangeHigh;
        const quantity = RiskManager.calculatePositionSize(
          this.executionEngine.getTotalEquity(),
          closePrice,
          stopLossPrice,
          this.config.riskPercent
        );

        if (quantity > 0) {
          const tp1Price = closePrice - riskPrice * 1.0;
          const tp2Price = closePrice - riskPrice * this.config.riskRewardRatio;

          const trade = this.executionEngine.openShortTrade(
            this.config.pair,
            closePrice,
            quantity,
            stopLossPrice,
            tp1Price,
            tp2Price
          );

          if (trade) {
            signals.push({
              type: 'ENTRY_SHORT',
              pair: this.config.pair,
              timestamp: Date.now(),
              price: formatPrice(closePrice, PRECISION.PRICE),
              stopLoss: stopLossPrice,
              takeProfit1: tp1Price,
              takeProfit2: tp2Price,
              reason: `Breakout below range low ${this.state.rangeLow.toFixed(2)}`,
              confidence: 0.8,
              relatedCandles: [],
            });

            this.state.tradeTaken = true;
            this._lockExecution();

            logger.info(
              `[BTCStrategy] ✅ SHORT EXECUTED: Close ${closePrice.toFixed(2)} < ` +
              `RangeLow ${this.state.rangeLow.toFixed(2)} | ` +
              `Qty: ${quantity.toFixed(6)} | SL: ${stopLossPrice.toFixed(2)} | ` +
              `TP1: ${tp1Price.toFixed(2)} | TP2: ${tp2Price.toFixed(2)}`
            );
          } else {
            // Trade failed — do NOT lock so next candle can retry
            logger.warn(
              `[BTCStrategy] SHORT trade failed to execute at ${closePrice.toFixed(2)}`
            );
          }
        } else {
          logger.warn('[BTCStrategy] Position size too small for short trade');
        }
      }
    }

    // ── Exit management on open trades ────────────────────────────────────────
    // Uses currentPrice (tick) for exit checks so stops/TPs are responsive
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
              timestamp: Date.now(),
              confidence: 1.0,
              reason: `TP1 hit at ${currentPrice}`,
              relatedCandles: [],
            });
          }
        } else if (RiskManager.isStopLossHit(currentPrice, trade.stopLoss, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtExit(trade.id, currentPrice, 'SL_HIT');
          if (closedTrade) {
            signals.push({
              pair: this.config.pair,
              type: 'EXIT_SL',
              price: currentPrice,
              timestamp: Date.now(),
              confidence: 1.0,
              reason: `Stop loss hit at ${currentPrice}`,
              relatedCandles: [],
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
              timestamp: Date.now(),
              confidence: 1.0,
              reason: `TP2 hit at ${currentPrice}`,
              relatedCandles: [],
            });
          }
        } else if (RiskManager.isStopLossHit(currentPrice, trade.stopLoss, trade.side)) {
          const closedTrade = this.executionEngine.closeTradeAtExit(trade.id, currentPrice, 'SL_HIT');
          if (closedTrade) {
            signals.push({
              pair: this.config.pair,
              type: 'EXIT_SL',
              price: currentPrice,
              timestamp: Date.now(),
              confidence: 1.0,
              reason: `Stop loss hit at ${currentPrice}`,
              relatedCandles: [],
            });
          }
        }
      }
    }

    return signals;
  }

  /**
   * Lock execution for 1 second to prevent duplicate signals on the same candle.
   * Only called after a SUCCESSFUL trade open.
   */
  private _lockExecution(): void {
    if (this.state.lockTimeout) {
      clearTimeout(this.state.lockTimeout);
    }

    this.state.signalLocked = true;
    this.state.lockTimeout = setTimeout(() => {
      this.state.signalLocked = false;
    }, 1000);
  }

  /**
   * Get current strategy state for monitoring
   */
  getState(): {
    rangeHigh: number | null;
    rangeLow: number | null;
    tradeTaken: boolean;
    last15mTime: number;
    lastCandleTimestamp: number;
  } {
    return {
      rangeHigh: this.state.rangeHigh,
      rangeLow: this.state.rangeLow,
      tradeTaken: this.state.tradeTaken,
      last15mTime: this.state.last15mTime,
      lastCandleTimestamp: this.state.lastCandleTimestamp,
    };
  }

  /**
   * Reset strategy state (for new pair or testing)
   */
  reset(): void {
    if (this.state.lockTimeout) {
      clearTimeout(this.state.lockTimeout);
    }
    this.state = {
      last15mTime: 0,
      lastCandleTimestamp: 0,
      rangeHigh: null,
      rangeLow: null,
      tradeTaken: false,
      signalLocked: false,
      lockTimeout: null,
    };
    logger.info(`[BTCStrategy] State reset for ${this.config.pair}`);
  }
}