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
 * - Detects first 3m candle of 15m block
 * - Captures range from that candle
 * - Trades breakout at ±0% (exact range boundaries)
 * - Position sized at 1% risk
 * - Stop loss at range low/high
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
      rangeHigh: null,
      rangeLow: null,
      tradeTaken: false,
      signalLocked: false,
      lockTimeout: null,
    };

    logger.info(`[BTCStrategy] Initialized for ${config.pair}`);
  }

  /**
   * Process new 3m candle and detect 15m range boundaries
   * Then check for breakout on current price
   */
  async processCandle(
    candles3m: Candle[],
    candles15m: Candle[],
    currentPrice: number
  ): Promise<Signal[]> {
    const signals: Signal[] = [];

    // Validation
    if (!candles3m || candles3m.length === 0) {
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

      // Reset for new 15m block
      this.state.tradeTaken = false;

      // Capture range from FIRST 3m candle of this new 15m block
      // This is the first 3m candle that opened at/near the 15m open
      const first3mOfBlock = candles3m[candles3m.length - 1];

      this.state.rangeHigh = first3mOfBlock.high;
      this.state.rangeLow = first3mOfBlock.low;

      logger.debug(
        `[BTCStrategy] New 15m block @ ${new Date(current15m.timestamp).toISOString()}: Range [${this.state.rangeLow}, ${this.state.rangeHigh}]`
      );
    }

    // Only process if we have a valid range
    if (this.state.rangeHigh === null || this.state.rangeLow === null) {
      return signals;
    }

    // Check for breakout (no offset, exact range boundaries)
    const longBreakout =
      !this.state.tradeTaken && currentPrice > this.state.rangeHigh;
    const shortBreakout =
      !this.state.tradeTaken && currentPrice < this.state.rangeLow;

    // Debug: Log price vs range every candle
    logger.debug(
      `[BTCStrategy] Price ${currentPrice.toFixed(2)} vs Range [${this.state.rangeLow?.toFixed(2)}, ${this.state.rangeHigh?.toFixed(2)}] | Long: ${longBreakout}, Short: ${shortBreakout}`
    );

    // Long breakout
    if (longBreakout && !this.state.signalLocked) {
      const riskPrice = currentPrice - this.state.rangeLow;

      if (riskPrice > 0) {
        const stopLossPrice = this.state.rangeLow;
        const quantity = RiskManager.calculatePositionSize(
          this.executionEngine.getTotalEquity(),
          currentPrice,
          stopLossPrice,
          this.config.riskPercent
        );

        if (quantity > 0) {
          const tp1Price = currentPrice + riskPrice * 1.0;
          const tp2Price = currentPrice + riskPrice * this.config.riskRewardRatio;

          // Execute trade using ExecutionEngine
          const trade = this.executionEngine.openLongTrade(
            this.config.pair,
            currentPrice,
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
              price: formatPrice(currentPrice, PRECISION.PRICE),
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
              `[BTCStrategy] LONG executed: Price ${currentPrice.toFixed(2)} > Range ${this.state.rangeHigh.toFixed(2)} | SL ${stopLossPrice.toFixed(2)} | TP2 ${tp2Price.toFixed(2)}`
            );
          }
        } else {
          logger.warn('[BTCStrategy] Position size too small for long trade');
        }
      }
    }

    // Short breakout
    if (shortBreakout && !this.state.signalLocked) {
      const riskPrice = this.state.rangeHigh - currentPrice;

      if (riskPrice > 0) {
        const stopLossPrice = this.state.rangeHigh;
        const quantity = RiskManager.calculatePositionSize(
          this.executionEngine.getTotalEquity(),
          currentPrice,
          stopLossPrice,
          this.config.riskPercent
        );

        if (quantity > 0) {
          const tp1Price = currentPrice - riskPrice * 1.0;
          const tp2Price = currentPrice - riskPrice * this.config.riskRewardRatio;

          // Execute trade using ExecutionEngine
          const trade = this.executionEngine.openShortTrade(
            this.config.pair,
            currentPrice,
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
              price: formatPrice(currentPrice, PRECISION.PRICE),
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
              `[BTCStrategy] SHORT executed: Price ${currentPrice.toFixed(2)} < Range ${this.state.rangeLow.toFixed(2)} | SL ${stopLossPrice.toFixed(2)} | TP2 ${tp2Price.toFixed(2)}`
            );
          }
        } else {
          logger.warn('[BTCStrategy] Position size too small for short trade');
        }
      }
    }

    // Check for exits on open trades
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
   * Lock execution for 1 second to prevent duplicate signals on same candle
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
  } {
    return {
      rangeHigh: this.state.rangeHigh,
      rangeLow: this.state.rangeLow,
      tradeTaken: this.state.tradeTaken,
      last15mTime: this.state.last15mTime,
    };
  }

  /**
   * Reset strategy state (for new pair or testing)
   */
  reset(): void {
    this.state = {
      last15mTime: 0,
      rangeHigh: null,
      rangeLow: null,
      tradeTaken: false,
      signalLocked: false,
      lockTimeout: null,
    };
    logger.info(`[BTCStrategy] State reset for ${this.config.pair}`);
  }
}
