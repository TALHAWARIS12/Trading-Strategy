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
   * Open a long position
   */
  openLongTrade(
    pair: string,
    entryPrice: number,
    quantity: number,
    stopLossPrice: number,
    tp1Price: number,
    tp2Price: number
  ): Trade | null {
    // Validate trade
    if (!RiskManager.isValidOrderQuantity(quantity, entryPrice)) {
      logger.warn(`Invalid order quantity for long: ${quantity} at ${entryPrice}`);
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
      database.insertTrade(trade).catch((err) => logger.error(`Failed to persist open long trade: ${err}`));
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

    logger.info(`Long trade opened: ${pair} @ ${entryPrice}, SL: ${stopLossPrice}, TP1: ${tp1Price}, TP2: ${tp2Price}`);

    return trade;
  }

  /**
   * Open a short position
   */
  openShortTrade(
    pair: string,
    entryPrice: number,
    quantity: number,
    stopLossPrice: number,
    tp1Price: number,
    tp2Price: number
  ): Trade | null {
    // Validate trade
    if (!RiskManager.isValidOrderQuantity(quantity, entryPrice)) {
      logger.warn(`Invalid order quantity for short: ${quantity} at ${entryPrice}`);
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
      database.insertTrade(trade).catch((err) => logger.error(`Failed to persist open short trade: ${err}`));
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

    logger.info(`Short trade opened: ${pair} @ ${entryPrice}, SL: ${stopLossPrice}, TP1: ${tp1Price}, TP2: ${tp2Price}`);

    return trade;
  }

  /**
   * Close a trade at take profit 1
   */
  closeTradeAtTP1(tradeId: string, currentPrice: number): Trade | null {
    const trade = this.openTrades.get(tradeId);
    if (!trade) {
      logger.warn(`Trade ${tradeId} not found`);
      return null;
    }

    const pnl = calculatePnL(trade.entryPrice, currentPrice, trade.entryQty, trade.side);
    const pnlPercent = calculatePnLPercent(trade.entryPrice, currentPrice, trade.side);

    trade.exitPrice = formatPrice(currentPrice, PRECISION.PRICE);
    trade.exitTime = getCurrentTimestamp();
    trade.status = 'TP1_PARTIAL_CLOSE';
    trade.pnl = formatPrice(pnl, PRECISION.PRICE);
    trade.pnlPercent = formatPrice(pnlPercent, PRECISION.PERCENTAGE);
    trade.exitReason = 'TP1_HIT';

    logTrade({
      event: 'TRADE_TP1_CLOSE',
      tradeId,
      pair: trade.pair,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice: currentPrice,
      quantity: trade.entryQty,
      pnl,
      pnlPercent,
      timestamp: trade.exitTime,
    });

    logger.info(`Trade ${tradeId} closed at TP1: PnL: ${pnl}, ${pnlPercent}%`);

    if (database.isReady()) {
      database.insertTrade(trade).catch((err) => logger.error(`Failed to persist TP1 trade: ${err}`));
    }

    return trade;
  }

  /**
   * Close a trade at take profit 2 or stop loss
   */
  closeTradeAtExit(tradeId: string, currentPrice: number, exitReason: 'TP2_HIT' | 'SL_HIT'): Trade | null {
    const trade = this.openTrades.get(tradeId);
    if (!trade) {
      logger.warn(`Trade ${tradeId} not found`);
      return null;
    }

    const pnl = calculatePnL(trade.entryPrice, currentPrice, trade.entryQty, trade.side);
    const pnlPercent = calculatePnLPercent(trade.entryPrice, currentPrice, trade.side);

    trade.exitPrice = formatPrice(currentPrice, PRECISION.PRICE);
    trade.exitTime = getCurrentTimestamp();
    trade.status = 'CLOSED';
    trade.pnl = formatPrice(pnl, PRECISION.PRICE);
    trade.pnlPercent = formatPrice(pnlPercent, PRECISION.PERCENTAGE);
    trade.exitReason = exitReason;

    this.closedTrades.push(trade);
    this.openTrades.delete(tradeId);

    // Update balance
    this.totalBalance += pnl;

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
      `Trade ${tradeId} closed at ${exitReason}: PnL: ${formatPrice(pnl, PRECISION.PRICE)}, ${formatPrice(pnlPercent, PRECISION.PERCENTAGE)}%`
    );

    if (database.isReady()) {
      database.insertTrade(trade).catch((err) => logger.error(`Failed to persist closed trade: ${err}`));
    }

    return trade;
  }

  /**
   * Get an open trade
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
   * Get open trades for a pair
   */
  getOpenTradesForPair(pair: string): Trade[] {
    return this.getOpenTrades().filter((t) => t.pair === pair);
  }

  /**
   * Check if there's an open trade for a pair
   */
  hasOpenTrade(pair: string): boolean {
    return this.getOpenTrades().some((t) => t.pair === pair);
  }

  /**
   * Get current unrealized PnL
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
   * Get realized PnL from closed trades
   */
  getRealizedPnL(): number {
    return formatPrice(
      this.closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0),
      PRECISION.PRICE
    );
  }

  /**
   * Get total equity
   */
  getTotalEquity(): number {
    return formatPrice(this.totalBalance, PRECISION.PRICE);
  }

  /**
   * Get current balance (equity - unrealized losses)
   */
  getCurrentBalance(): number {
    return formatPrice(this.totalBalance, PRECISION.PRICE);
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): Record<string, number> {
    const closedTrades = this.getClosedTrades();
    const openTrades = this.getOpenTrades();
    const totalTrades = closedTrades.length + openTrades.length;

    const winningTrades = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / closedTrades.length) * 100 : 0;

    const totalPnL = this.getRealizedPnL();
    const totalPnLPercent = this.initialBalance > 0 ? (totalPnL / this.initialBalance) * 100 : 0;

    const avgWin =
      winningTrades > 0
        ? closedTrades.filter((t) => (t.pnl || 0) > 0).reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades
        : 0;

    const losingTrades = closedTrades.filter((t) => (t.pnl || 0) < 0).length;
    const avgLoss =
      losingTrades > 0
        ? Math.abs(closedTrades.filter((t) => (t.pnl || 0) < 0).reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades)
        : 0;

    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;

    return {
      totalTrades,
      closedTrades: closedTrades.length,
      openTrades: openTrades.length,
      winningTrades,
      losingTrades,
      winRate: formatPrice(winRate, PRECISION.PERCENTAGE),
      totalPnL: formatPrice(totalPnL, PRECISION.PRICE),
      totalPnLPercent: formatPrice(totalPnLPercent, PRECISION.PERCENTAGE),
      avgWin: formatPrice(avgWin, PRECISION.PRICE),
      avgLoss: formatPrice(avgLoss, PRECISION.PRICE),
      profitFactor: formatPrice(profitFactor, PRECISION.PRICE),
    };
  }

  /**
   * Reset trading engine (for paper account reset)
   */
  reset(newBalance: number): void {
    this.openTrades.clear();
    this.closedTrades = [];
    this.totalBalance = newBalance;
    this.initialBalance = newBalance;
    logger.info(`Trading engine reset with balance: ${newBalance}`);
  }

  /**
   * Load trades (e.g. from database recovery)
   */
  loadTrades(openTrades: Trade[], closedTrades: Trade[]): void {
    this.openTrades.clear();
    for (const trade of openTrades) {
      this.openTrades.set(trade.id, trade);
    }
    this.closedTrades = [...closedTrades];

    // Recalculate balance based on closed trades PnL
    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    this.totalBalance = this.initialBalance + totalPnL;

    logger.info(`Loaded ${openTrades.length} open and ${closedTrades.length} closed trades. Balance updated to: ${this.totalBalance}`);
  }
}
