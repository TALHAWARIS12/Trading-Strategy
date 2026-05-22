import { Trade, Position, PortfolioMetrics } from '@/types';
import { ExecutionEngine } from '@/execution';
import { calculateMaxDrawdown, calculateSharpeRatio, formatPrice, getCurrentTimestamp } from '@/utils';
import { PRECISION } from '@/constants';
import logger from '@/logging';

export class Portfolio {
  private executionEngine: ExecutionEngine;
  private equityCurve: number[] = [];
  private dailyLosses: Map<string, number> = new Map(); // key: date (YYYY-MM-DD)

  constructor(executionEngine: ExecutionEngine) {
    this.executionEngine = executionEngine;
    this.recordEquity();
  }

  /**
   * Get current positions across all pairs
   */
  getPositions(currentPrices: Map<string, number>): Position[] {
    const positions: Position[] = [];
    const trades = this.executionEngine.getOpenTrades();

    for (const trade of trades) {
      const currentPrice = currentPrices.get(trade.pair);
      if (!currentPrice) continue;

      const pnl = this.calculateUnrealizedPnL(trade, currentPrice);
      const pnlPercent = this.calculateUnrealizedPnLPercent(trade, currentPrice);

      positions.push({
        id: trade.id,
        pair: trade.pair,
        side: trade.side,
        qty: trade.entryQty,
        entryPrice: trade.entryPrice,
        entryTime: trade.entryTime,
        currentPrice,
        pnl,
        pnlPercent,
        stopLoss: trade.stopLoss,
        takeProfit1: trade.takeProfit1,
        takeProfit2: trade.takeProfit2,
        isClosed: false,
      });
    }

    return positions;
  }

  /**
   * Get portfolio metrics
   */
  getMetrics(currentPrices: Map<string, number>): PortfolioMetrics {
    const totalBalance = this.executionEngine.getTotalEquity();
    const unrealizedPnL = this.executionEngine.getUnrealizedPnL(currentPrices);
    const realizedPnL = this.executionEngine.getRealizedPnL();
    const totalPnL = formatPrice(unrealizedPnL + realizedPnL, PRECISION.PRICE);
    const totalPnLPercent = formatPrice(
      ((totalPnL) / this.executionEngine.getTotalEquity()) * 100,
      PRECISION.PERCENTAGE
    );

    const performanceMetrics = this.executionEngine.getPerformanceMetrics();
    const openTrades = this.executionEngine.getOpenTrades();
    const closedTrades = this.executionEngine.getClosedTrades();

    const maxDrawdown = calculateMaxDrawdown(this.equityCurve) * 100;
    const returns = this.calculateReturns();
    const sharpeRatio = calculateSharpeRatio(returns);

    return {
      totalBalance: formatPrice(totalBalance, PRECISION.PRICE),
      availableBalance: formatPrice(totalBalance - unrealizedPnL, PRECISION.PRICE),
      usedBalance: formatPrice(unrealizedPnL, PRECISION.PRICE),
      unrealizedPnL: formatPrice(unrealizedPnL, PRECISION.PRICE),
      realizedPnL: formatPrice(realizedPnL, PRECISION.PRICE),
      totalPnL: formatPrice(totalPnL, PRECISION.PRICE),
      totalPnLPercent: formatPrice(totalPnLPercent, PRECISION.PERCENTAGE),
      winRate: performanceMetrics.winRate as number,
      totalTrades: performanceMetrics.totalTrades as number,
      closedTrades: closedTrades.length,
      openPositions: openTrades.length,
      maxDrawdown: formatPrice(maxDrawdown, PRECISION.PERCENTAGE),
      sharpeRatio: formatPrice(sharpeRatio, PRECISION.PERCENTAGE),
    };
  }

  /**
   * Record equity snapshot
   */
  recordEquity(): void {
    const currentEquity = this.executionEngine.getTotalEquity();
    this.equityCurve.push(currentEquity);

    // Keep last 10000 snapshots
    if (this.equityCurve.length > 10000) {
      this.equityCurve.shift();
    }
  }

  /**
   * Get equity curve
   */
  getEquityCurve(): number[] {
    return [...this.equityCurve];
  }

  /**
   * Calculate daily loss
   */
  recordDailyLoss(loss: number): void {
    const today = new Date().toISOString().split('T')[0];
    const currentLoss = this.dailyLosses.get(today) || 0;
    this.dailyLosses.set(today, currentLoss + Math.abs(loss));
  }

  /**
   * Check if daily loss limit exceeded
   */
  isDailyLossLimitExceeded(maxDailyLossPercent: number): boolean {
    const today = new Date().toISOString().split('T')[0];
    const dailyLoss = this.dailyLosses.get(today) || 0;
    const maxDailyLoss = this.executionEngine.getTotalEquity() * (maxDailyLossPercent / 100);
    return dailyLoss > maxDailyLoss;
  }

  /**
   * Get daily loss
   */
  getDailyLoss(): number {
    const today = new Date().toISOString().split('T')[0];
    return this.dailyLosses.get(today) || 0;
  }

  /**
   * Calculate unrealized PnL for a trade
   */
  private calculateUnrealizedPnL(trade: Trade, currentPrice: number): number {
    const priceDiff = currentPrice - trade.entryPrice;
    const pnl = trade.side === 'LONG' ? priceDiff * trade.entryQty : -priceDiff * trade.entryQty;
    return formatPrice(pnl, PRECISION.PRICE);
  }

  /**
   * Calculate unrealized PnL percent for a trade
   */
  private calculateUnrealizedPnLPercent(trade: Trade, currentPrice: number): number {
    if (trade.entryPrice === 0) return 0;
    const percentChange = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const pnlPercent = trade.side === 'LONG' ? percentChange : -percentChange;
    return formatPrice(pnlPercent, PRECISION.PERCENTAGE);
  }

  /**
   * Calculate returns for Sharpe ratio
   */
  private calculateReturns(): number[] {
    if (this.equityCurve.length < 2) return [];

    const returns: number[] = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const ret = (this.equityCurve[i] - this.equityCurve[i - 1]) / this.equityCurve[i - 1];
      returns.push(ret);
    }

    return returns;
  }

  /**
   * Reset portfolio
   */
  reset(): void {
    this.equityCurve = [];
    this.dailyLosses.clear();
    this.recordEquity();
    logger.info('Portfolio reset');
  }
}
