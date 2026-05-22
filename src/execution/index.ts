import { Trade, Position } from '@/types';
import { generateId, getCurrentTimestamp, calculatePnL, calculatePnLPercent, formatPrice } from '@/utils';
import { TRADE_STATUS, POSITION_TYPES, PRECISION } from '@/constants';
import logger, { logTrade } from '@/logging';
import { RiskManager } from '@/risk';
import { database } from '@/database';

export class ExecutionEngine {
  private openTrades: Map<string, Trade> = new Map();
  private closedTrades: Trade[] = [];
  private totalBalance: number;
  private initialBalance: number;

  constructor(initialBalance: number) {
    this.initialBalance = initialBalance;
    this.totalBalance = initialBalance;
  }

  /**
   * Open a long position.
   * Checks that we have sufficient balance before accepting the trade.
   */
  openLongTrade(
    pair: string,
    entryPrice: number,
    quantity: number,
    stopLossPrice: number,
    tp1Price: number,
    tp2Price: number
  ): Trade | null {
    if (!RiskManager.isValidOrderQuantity(quantity, entryPrice)) {
      logger.warn(`[ExecutionEngine] Invalid order quantity for long: ${quantity} at ${entryPrice}`);
      return null;
    }

    // Reject if we already have an open trade for this pair to prevent doubling up
    if (this.hasOpenTrade(pair)) {
      logger.warn(`[ExecutionEngine] Already have an open trade for ${pair} — skipping long entry`);
      return null;
    }

    // Basic margin check: notional cost must not exceed available balance
    const notionalCost = quantity * entryPrice;
    if (notionalCost > this.totalBalance) {
      logger.warn(
        `[ExecutionEngine] Insufficient balance for long: need ${notionalCost.toFixed(2)}, ` +
        `have ${this.totalBalance.toFixed(2)}`
      );
      return null;
    }

    const tradeId = generateId('LONG');
    const trade: Trade = {
      id: tradeId,
      pair,
      side: 'LONG',
      entryPrice: formatPrice(entryPrice, PRECISION.PRICE),
      entryQty: quantity,
      entryTime: getCurrentTimestamp(),
      stopLoss: formatPrice(stopLossPrice, PRECISION.PRICE),
      takeProfit1: formatPrice(tp1Price, PRECISION.PRICE),
      takeProfit2: formatPrice(tp2Price, PRECISION.PRICE),
      status: 'OPEN',
    };

    this.openTrades.set(tradeId, trade);

    if (database.isReady()) {
      database.insertTrade(trade).catch((err) =>
        logger.error(`[ExecutionEngine] Failed to persist open long trade: ${err}`)
      );
    }

    logTrade({
      event: 'TRADE_OPEN',
      tradeId,
      pair,
      side: 'LONG',
      entryPrice,
      quantity,
      stopLoss: stopLossPrice,
      tp1: tp1Price,
      tp2: tp2Price,
      timestamp: trade.entryTime,
    });

    logger.info(
      `[ExecutionEngine] Long trade opened: ${pair} @ ${entryPrice} | ` +
      `Qty: ${quantity} | SL: ${stopLossPrice} | TP1: ${tp1Price} | TP2: ${tp2Price}`
    );

    return trade;
  }

  /**
   * Open a short position.
   * Checks that we have sufficient balance before accepting the trade.
   */
  openShortTrade(
    pair: string,
    entryPrice: number,
    quantity: number,
    stopLossPrice: number,
    tp1Price: number,
    tp2Price: number
  ): Trade | null {
    if (!RiskManager.isValidOrderQuantity(quantity, entryPrice)) {
      logger.warn(`[ExecutionEngine] Invalid order quantity for short: ${quantity} at ${entryPrice}`);
      return null;
    }

    // Reject if we already have an open trade for this pair
    if (this.hasOpenTrade(pair)) {
      logger.warn(`[ExecutionEngine] Already have an open trade for ${pair} — skipping short entry`);
      return null;
    }

    // Basic margin check
    const notionalCost = quantity * entryPrice;
    if (notionalCost > this.totalBalance) {
      logger.warn(
        `[ExecutionEngine] Insufficient balance for short: need ${notionalCost.toFixed(2)}, ` +
        `have ${this.totalBalance.toFixed(2)}`
      );
      return null;
    }

    const tradeId = generateId('SHORT');
    const trade: Trade = {
      id: tradeId,
      pair,
      side: 'SHORT',
      entryPrice: formatPrice(entryPrice, PRECISION.PRICE),
      entryQty: quantity,
      entryTime: getCurrentTimestamp(),
      stopLoss: formatPrice(stopLossPrice, PRECISION.PRICE),
      takeProfit1: formatPrice(tp1Price, PRECISION.PRICE),
      takeProfit2: formatPrice(tp2Price, PRECISION.PRICE),
      status: 'OPEN',
    };

    this.openTrades.set(tradeId, trade);

    if (database.isReady()) {
      database.insertTrade(trade).catch((err) =>
        logger.error(`[ExecutionEngine] Failed to persist open short trade: ${err}`)
      );
    }

    logTrade({
      event: 'TRADE_OPEN',
      tradeId,
      pair,
      side: 'SHORT',
      entryPrice,
      quantity,
      stopLoss: stopLossPrice,
      tp1: tp1Price,
      tp2: tp2Price,
      timestamp: trade.entryTime,
    });

    logger.info(
      `[ExecutionEngine] Short trade opened: ${pair} @ ${entryPrice} | ` +
      `Qty: ${quantity} | SL: ${stopLossPrice} | TP1: ${tp1Price} | TP2: ${tp2Price}`
    );

    return trade;
  }

  /**
   * Close HALF the position at TP1.
   *
   * Bug fix: original code set status to TP1_PARTIAL_CLOSE but never updated
   * the balance and never re-inserted the trade into openTrades under its
   * updated state, so TP2/SL checks on the same trade would still see
   * status='OPEN' on the next tick via the stale Map reference.
   *
   * Now:
   * - Realises PnL on 50% of qty and adds it to balance.
   * - Updates remaining qty on the trade object in-place (stays in openTrades).
   * - Persists the updated trade to the database.
   */
  closeTradeAtTP1(tradeId: string, currentPrice: number): Trade | null {
    const trade = this.openTrades.get(tradeId);
    if (!trade) {
      logger.warn(`[ExecutionEngine] Trade ${tradeId} not found for TP1 close`);
      return null;
    }

    if (trade.status !== 'OPEN') {
      logger.warn(`[ExecutionEngine] Trade ${tradeId} is not OPEN (status: ${trade.status}) — skipping TP1`);
      return null;
    }

    // Close 50% of the position at TP1
    const tp1Qty = trade.entryQty / 2;
    const pnl = calculatePnL(trade.entryPrice, currentPrice, tp1Qty, trade.side);
    const pnlPercent = calculatePnLPercent(trade.entryPrice, currentPrice, trade.side);

    // Update balance with realised profit on the partial close
    this.totalBalance += pnl;

    // Mutate trade in-place — it stays in openTrades for TP2/SL monitoring
    trade.exitPrice    = formatPrice(currentPrice, PRECISION.PRICE);
    trade.exitTime     = getCurrentTimestamp();
    trade.status       = 'TP1_PARTIAL_CLOSE';
    trade.pnl          = formatPrice(pnl, PRECISION.PRICE);
    trade.pnlPercent   = formatPrice(pnlPercent, PRECISION.PERCENTAGE);
    trade.exitReason   = 'TP1_HIT';
    trade.entryQty     = tp1Qty; // remaining qty for TP2/SL leg

    logTrade({
      event: 'TRADE_TP1_CLOSE',
      tradeId,
      pair: trade.pair,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice: currentPrice,
      quantity: tp1Qty,
      pnl,
      pnlPercent,
      timestamp: trade.exitTime,
    });

    logger.info(
      `[ExecutionEngine] Trade ${tradeId} TP1 partial close: ` +
      `${tp1Qty.toFixed(6)} @ ${currentPrice} | ` +
      `PnL: ${formatPrice(pnl, PRECISION.PRICE)} (${formatPrice(pnlPercent, PRECISION.PERCENTAGE)}%) | ` +
      `Balance: ${this.totalBalance.toFixed(2)}`
    );

    if (database.isReady()) {
      database.insertTrade(trade).catch((err) =>
        logger.error(`[ExecutionEngine] Failed to persist TP1 trade: ${err}`)
      );
    }

    return trade;
  }

  /**
   * Fully close a trade at TP2 or stop loss.
   */
  closeTradeAtExit(tradeId: string, currentPrice: number, exitReason: 'TP2_HIT' | 'SL_HIT'): Trade | null {
    const trade = this.openTrades.get(tradeId);
    if (!trade) {
      logger.warn(`[ExecutionEngine] Trade ${tradeId} not found for exit close`);
      return null;
    }

    const pnl = calculatePnL(trade.entryPrice, currentPrice, trade.entryQty, trade.side);
    const pnlPercent = calculatePnLPercent(trade.entryPrice, currentPrice, trade.side);

    // Update balance with realised PnL on remaining qty
    this.totalBalance += pnl;

    trade.exitPrice  = formatPrice(currentPrice, PRECISION.PRICE);
    trade.exitTime   = getCurrentTimestamp();
    trade.status     = 'CLOSED';
    trade.pnl        = formatPrice((trade.pnl || 0) + pnl, PRECISION.PRICE); // accumulate with TP1 pnl if any
    trade.pnlPercent = formatPrice(pnlPercent, PRECISION.PERCENTAGE);
    trade.exitReason = exitReason;

    this.closedTrades.push(trade);
    this.openTrades.delete(tradeId);

    logTrade({
      event: 'TRADE_CLOSE',
      tradeId,
      pair: trade.pair,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice: currentPrice,
      quantity: trade.entryQty,
      exitReason,
      pnl,
      pnlPercent,
      timestamp: trade.exitTime,
    });

    logger.info(
      `[ExecutionEngine] Trade ${tradeId} closed at ${exitReason}: ` +
      `${currentPrice} | PnL: ${formatPrice(pnl, PRECISION.PRICE)} ` +
      `(${formatPrice(pnlPercent, PRECISION.PERCENTAGE)}%) | ` +
      `Balance: ${this.totalBalance.toFixed(2)}`
    );

    if (database.isReady()) {
      database.insertTrade(trade).catch((err) =>
        logger.error(`[ExecutionEngine] Failed to persist closed trade: ${err}`)
      );
    }

    return trade;
  }

  /**
   * Get a single open trade by ID
   */
  getOpenTrade(tradeId: string): Trade | null {
    return this.openTrades.get(tradeId) || null;
  }

  /**
   * Get all open trades
   */
  getOpenTrades(): Trade[] {
    return Array.from(this.openTrades.values());
  }

  /**
   * Get all closed trades
   */
  getClosedTrades(): Trade[] {
    return this.closedTrades;
  }

  /**
   * Get open trades for a specific pair
   */
  getOpenTradesForPair(pair: string): Trade[] {
    return this.getOpenTrades().filter((t) => t.pair === pair);
  }

  /**
   * Check if there is any open trade for a pair
   */
  hasOpenTrade(pair: string): boolean {
    return this.getOpenTrades().some((t) => t.pair === pair);
  }

  /**
   * Get current unrealized PnL across all open trades
   */
  getUnrealizedPnL(currentPrices: Map<string, number>): number {
    let totalUnrealizedPnL = 0;

    this.openTrades.forEach((trade) => {
      const currentPrice = currentPrices.get(trade.pair);
      if (!currentPrice) return;

      const pnl = calculatePnL(trade.entryPrice, currentPrice, trade.entryQty, trade.side);
      totalUnrealizedPnL += pnl;
    });

    return formatPrice(totalUnrealizedPnL, PRECISION.PRICE);
  }

  /**
   * Get realized PnL from all closed trades
   */
  getRealizedPnL(): number {
    return formatPrice(
      this.closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0),
      PRECISION.PRICE
    );
  }

  /**
   * Get total equity (realized balance only).
   * Used for position sizing — does NOT include unrealized PnL to avoid
   * over-sizing on open positions.
   */
  getTotalEquity(): number {
    return formatPrice(this.totalBalance, PRECISION.PRICE);
  }

  /**
   * Get current cash balance
   */
  getCurrentBalance(): number {
    return formatPrice(this.totalBalance, PRECISION.PRICE);
  }

  /**
   * Get full performance metrics
   */
  getPerformanceMetrics(): Record<string, number> {
    const closedTrades = this.getClosedTrades();
    const openTrades   = this.getOpenTrades();
    const totalTrades  = closedTrades.length + openTrades.length;

    const winningTrades = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
    const losingTrades  = closedTrades.filter((t) => (t.pnl || 0) < 0).length;

    // Guard against division by zero when no closed trades yet
    const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;

    const totalPnL        = this.getRealizedPnL();
    const totalPnLPercent = this.initialBalance > 0 ? (totalPnL / this.initialBalance) * 100 : 0;

    const avgWin =
      winningTrades > 0
        ? closedTrades
            .filter((t) => (t.pnl || 0) > 0)
            .reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades
        : 0;

    const avgLoss =
      losingTrades > 0
        ? Math.abs(
            closedTrades
              .filter((t) => (t.pnl || 0) < 0)
              .reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades
          )
        : 0;

    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;

    return {
      totalTrades,
      closedTrades:     closedTrades.length,
      openTrades:       openTrades.length,
      winningTrades,
      losingTrades,
      winRate:          formatPrice(winRate, PRECISION.PERCENTAGE),
      totalPnL:         formatPrice(totalPnL, PRECISION.PRICE),
      totalPnLPercent:  formatPrice(totalPnLPercent, PRECISION.PERCENTAGE),
      avgWin:           formatPrice(avgWin, PRECISION.PRICE),
      avgLoss:          formatPrice(avgLoss, PRECISION.PRICE),
      profitFactor:     formatPrice(profitFactor, PRECISION.PRICE),
    };
  }

  /**
   * Reset the engine (paper account reset)
   */
  reset(newBalance: number): void {
    this.openTrades.clear();
    this.closedTrades = [];
    this.totalBalance = newBalance;
    this.initialBalance = newBalance;
    logger.info(`[ExecutionEngine] Engine reset with balance: ${newBalance}`);
  }

  /**
   * Load trades from database recovery.
   * Recalculates balance from closed trade PnL so the in-memory state
   * matches what was persisted.
   */
  loadTrades(openTrades: Trade[], closedTrades: Trade[]): void {
    this.openTrades.clear();
    for (const trade of openTrades) {
      this.openTrades.set(trade.id, trade);
    }
    this.closedTrades = [...closedTrades];

    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    this.totalBalance = this.initialBalance + totalPnL;

    logger.info(
      `[ExecutionEngine] Loaded ${openTrades.length} open and ${closedTrades.length} closed trades. ` +
      `Balance updated to: ${this.totalBalance}`
    );
  }
}