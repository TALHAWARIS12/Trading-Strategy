import { RISK, PRECISION } from '@/constants';
import { formatQuantity, formatPrice } from '@/utils';
import logger from '@/logging';

export interface RiskParameters {
  riskPercent: number;
  riskRewardRatio: number;
  atrMultiplier: number;
}

export interface PositionSizing {
  entryPrice: number;
  stopLossPrice: number;
  riskAmount: number;
  positionSize: number;
  takeProfitPrice1: number;
  takeProfitPrice2: number;
}

export class RiskManager {
  /**
   * Validate risk parameters
   */
  static validateRiskParams(params: RiskParameters): boolean {
    if (params.riskPercent < RISK.MIN_RISK_PERCENT || params.riskPercent > RISK.MAX_RISK_PERCENT) {
      logger.warn(
        `Risk percent ${params.riskPercent} out of valid range [${RISK.MIN_RISK_PERCENT}, ${RISK.MAX_RISK_PERCENT}]`
      );
      return false;
    }

    if (params.riskRewardRatio < RISK.MIN_RR_RATIO || params.riskRewardRatio > RISK.MAX_RR_RATIO) {
      logger.warn(
        `Risk/Reward ratio ${params.riskRewardRatio} out of valid range [${RISK.MIN_RR_RATIO}, ${RISK.MAX_RR_RATIO}]`
      );
      return false;
    }

    if (params.atrMultiplier <= 0 || params.atrMultiplier > 5) {
      logger.warn(`ATR multiplier ${params.atrMultiplier} out of valid range (0, 5]`);
      return false;
    }

    return true;
  }

  /**
   * Calculate position size based on risk
   */
  static calculatePositionSize(
    equity: number,
    entryPrice: number,
    stopLossPrice: number,
    riskPercent: number
  ): number {
    if (!this.isValidPrice(entryPrice) || !this.isValidPrice(stopLossPrice)) {
      logger.error('Invalid prices for position sizing');
      return 0;
    }

    if (entryPrice === stopLossPrice) {
      logger.warn('Entry price equals stop loss price');
      return 0;
    }

    const riskAmount = equity * (riskPercent / 100);
    const priceRisk = Math.abs(entryPrice - stopLossPrice);

    let positionSize = riskAmount / priceRisk;

    // Apply precision
    positionSize = formatQuantity(positionSize, PRECISION.QUANTITY);

    // Cap position size to maximum affordable size based on equity
    const maxPositionSize = this.getMaxPositionSize(equity, entryPrice);
    if (positionSize > maxPositionSize) {
      logger.info(
        `[RiskManager] Position size ${positionSize} exceeds max affordable size ${maxPositionSize} ` +
        `for equity ${equity.toFixed(2)} at price ${entryPrice.toFixed(2)}. Capping to maxPositionSize.`
      );
      positionSize = maxPositionSize;
    }

    // Validate minimum order size (Binance requires 10 USDT minimum)
    const minNotional = 10;
    const notionalValue = positionSize * entryPrice;
    if (notionalValue < minNotional) {
      logger.warn(`Position size ${positionSize} would result in notional value ${notionalValue} < ${minNotional}`);
      return 0;
    }

    return positionSize;
  }

  /**
   * Calculate stop loss for a long position
   */
  static calculateLongStopLoss(entryPrice: number, atr: number, atrMultiplier: number): number {
    const stopLoss = entryPrice - atr * atrMultiplier;
    return formatPrice(stopLoss, PRECISION.PRICE);
  }

  /**
   * Calculate stop loss for a short position
   */
  static calculateShortStopLoss(entryPrice: number, atr: number, atrMultiplier: number): number {
    const stopLoss = entryPrice + atr * atrMultiplier;
    return formatPrice(stopLoss, PRECISION.PRICE);
  }

  /**
   * Calculate take profit for a long position
   */
  static calculateLongTakeProfit(entryPrice: number, atr: number, atrMultiplier: number, rrRatio: number): number {
    const riskDistance = atr * atrMultiplier;
    const profitDistance = riskDistance * rrRatio;
    const takeProfit = entryPrice + profitDistance;
    return formatPrice(takeProfit, PRECISION.PRICE);
  }

  /**
   * Calculate take profit for a short position
   */
  static calculateShortTakeProfit(entryPrice: number, atr: number, atrMultiplier: number, rrRatio: number): number {
    const riskDistance = atr * atrMultiplier;
    const profitDistance = riskDistance * rrRatio;
    const takeProfit = entryPrice - profitDistance;
    return formatPrice(takeProfit, PRECISION.PRICE);
  }

  /**
   * Calculate TP1 (1R profit)
   */
  static calculateTP1(entryPrice: number, atr: number, atrMultiplier: number, side: 'LONG' | 'SHORT'): number {
    const riskDistance = atr * atrMultiplier;
    if (side === 'LONG') {
      return formatPrice(entryPrice + riskDistance, PRECISION.PRICE);
    } else {
      return formatPrice(entryPrice - riskDistance, PRECISION.PRICE);
    }
  }

  /**
   * Calculate TP2 (RR multiple profit)
   */
  static calculateTP2(
    entryPrice: number,
    atr: number,
    atrMultiplier: number,
    rrRatio: number,
    side: 'LONG' | 'SHORT'
  ): number {
    const riskDistance = atr * atrMultiplier;
    const profitDistance = riskDistance * rrRatio;
    if (side === 'LONG') {
      return formatPrice(entryPrice + profitDistance, PRECISION.PRICE);
    } else {
      return formatPrice(entryPrice - profitDistance, PRECISION.PRICE);
    }
  }

  /**
   * Check if stop loss was hit
   */
  static isStopLossHit(currentPrice: number, stopLossPrice: number, side: 'LONG' | 'SHORT'): boolean {
    if (side === 'LONG') {
      return currentPrice <= stopLossPrice;
    } else {
      return currentPrice >= stopLossPrice;
    }
  }

  /**
   * Check if take profit was hit
   */
  static isTakeProfitHit(currentPrice: number, takeProfitPrice: number, side: 'LONG' | 'SHORT'): boolean {
    if (side === 'LONG') {
      return currentPrice >= takeProfitPrice;
    } else {
      return currentPrice <= takeProfitPrice;
    }
  }

  /**
   * Calculate unrealized PnL
   */
  static calculateUnrealizedPnL(entryPrice: number, currentPrice: number, quantity: number, side: 'LONG' | 'SHORT'): number {
    const priceDiff = currentPrice - entryPrice;
    return side === 'LONG' ? priceDiff * quantity : -priceDiff * quantity;
  }

  /**
   * Calculate unrealized PnL percentage
   */
  static calculateUnrealizedPnLPercent(entryPrice: number, currentPrice: number, side: 'LONG' | 'SHORT'): number {
    if (entryPrice === 0) return 0;
    const percentChange = ((currentPrice - entryPrice) / entryPrice) * 100;
    return side === 'LONG' ? percentChange : -percentChange;
  }

  /**
   * Validate position can be opened
   */
  static canOpenPosition(
    currentBalance: number,
    positionSize: number,
    entryPrice: number,
    maxOpenPositions: number,
    currentOpenPositions: number,
    maxDailyLoss: number,
    currentDailyLoss: number
  ): { valid: boolean; reason?: string } {
    // Check balance
    const requiredBalance = positionSize * entryPrice;
    if (requiredBalance > currentBalance) {
      return { valid: false, reason: 'Insufficient balance' };
    }

    // Check max open positions
    if (currentOpenPositions >= maxOpenPositions) {
      return { valid: false, reason: 'Max concurrent positions reached' };
    }

    // Check daily loss limit
    if (currentDailyLoss >= maxDailyLoss) {
      return { valid: false, reason: 'Daily loss limit reached' };
    }

    return { valid: true };
  }

  /**
   * Check if order quantity is valid for Binance
   */
  static isValidOrderQuantity(quantity: number, price: number): boolean {
    // Binance minimum notional value is 10 USDT
    const notionalValue = quantity * price;
    return notionalValue >= 10 && quantity > 0;
  }

  /**
   * Check if price is valid
   */
  private static isValidPrice(price: number): boolean {
    return price > 0 && Number.isFinite(price);
  }

  static getMaxPositionSize(equity: number, entryPrice: number, minNotional: number = 10): number {
    if (!this.isValidPrice(entryPrice)) return 0;
    // Use 99.9% of equity to leave a tiny buffer for precision/rounding
    const maxSize = (equity * 0.999) / entryPrice;
    const minSize = minNotional / entryPrice;
    if (maxSize < minSize) return 0;

    const decimals = PRECISION.QUANTITY;
    const factor = Math.pow(10, decimals);
    return Math.floor(maxSize * factor) / factor;
  }

  /**
   * Calculate risk amount in USD
   */
  static calculateRiskAmount(equity: number, riskPercent: number): number {
    return formatPrice(equity * (riskPercent / 100), PRECISION.PRICE);
  }

  /**
   * Get position sizing details
   */
  static getPositionSizingDetails(
    equity: number,
    entryPrice: number,
    stopLossPrice: number,
    atr: number,
    atrMultiplier: number,
    riskPercent: number,
    rrRatio: number,
    side: 'LONG' | 'SHORT'
  ): PositionSizing | null {
    const positionSize = this.calculatePositionSize(equity, entryPrice, stopLossPrice, riskPercent);

    if (positionSize === 0) {
      return null;
    }

    const riskAmount = this.calculateRiskAmount(equity, riskPercent);

    const takeProfitPrice1 = this.calculateTP1(entryPrice, atr, atrMultiplier, side);
    const takeProfitPrice2 = this.calculateTP2(entryPrice, atr, atrMultiplier, rrRatio, side);

    return {
      entryPrice: formatPrice(entryPrice, PRECISION.PRICE),
      stopLossPrice: formatPrice(stopLossPrice, PRECISION.PRICE),
      riskAmount,
      positionSize,
      takeProfitPrice1,
      takeProfitPrice2,
    };
  }
}
