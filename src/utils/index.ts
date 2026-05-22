import crypto from 'crypto';
import { INTERVALS_MS, PRECISION } from '@/constants';


/**
 * Get the Unix timestamp in milliseconds
 */
export function getCurrentTimestamp(): number {
  return Date.now();
}

/**
 * Get candle open time from timestamp
 */
export function getCandleOpenTime(timestamp: number, interval: string): number {
  const intervalMs = INTERVALS_MS[interval as keyof typeof INTERVALS_MS];
  if (!intervalMs) throw new Error(`Invalid interval: ${interval}`);
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

/**
 * Get candle close time from timestamp
 */
export function getCandleCloseTime(timestamp: number, interval: string): number {
  return getCandleOpenTime(timestamp, interval) + INTERVALS_MS[interval as keyof typeof INTERVALS_MS] - 1;
}

/**
 * Check if a candle is closed
 */
export function isCandleClosed(timestamp: number, candleOpenTime: number, interval: string): boolean {
  const intervalMs = INTERVALS_MS[interval as keyof typeof INTERVALS_MS];
  if (!intervalMs) return false;
  return timestamp >= candleOpenTime + intervalMs;
}

/**
 * Format a number to a specific number of decimal places
 */
export function formatPrice(price: number, decimals: number = PRECISION.PRICE): number {
  const factor = Math.pow(10, decimals);
  return Math.round(price * factor) / factor;
}

/**
 * Format quantity to precision
 */
export function formatQuantity(qty: number, decimals: number = PRECISION.QUANTITY): number {
  const factor = Math.pow(10, decimals);
  return Math.round(qty * factor) / factor;
}

/**
 * Format percentage
 */
export function formatPercent(value: number, decimals: number = PRECISION.PERCENTAGE): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Calculate position size based on risk
 */
export function calculatePositionSize(
  equity: number,
  riskPercent: number,
  entryPrice: number,
  stopLossPrice: number
): number {
  const riskAmount = equity * (riskPercent / 100);
  const priceRisk = Math.abs(entryPrice - stopLossPrice);
  if (priceRisk === 0) return 0;
  return riskAmount / priceRisk;
}

/**
 * Calculate stop loss level
 */
export function calculateStopLoss(
  entryPrice: number,
  side: 'LONG' | 'SHORT',
  slDistance: number
): number {
  if (side === 'LONG') {
    return entryPrice - slDistance;
  } else {
    return entryPrice + slDistance;
  }
}

/**
 * Calculate take profit level
 */
export function calculateTakeProfit(
  entryPrice: number,
  side: 'LONG' | 'SHORT',
  tpDistance: number
): number {
  if (side === 'LONG') {
    return entryPrice + tpDistance;
  } else {
    return entryPrice - tpDistance;
  }
}

/**
 * Calculate PnL
 */
export function calculatePnL(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  side: 'LONG' | 'SHORT'
): number {
  const priceChange = side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return priceChange * quantity;
}

/**
 * Calculate PnL percentage
 */
export function calculatePnLPercent(entryPrice: number, exitPrice: number, side: 'LONG' | 'SHORT'): number {
  if (entryPrice === 0) return 0;
  const percentChange = ((exitPrice - entryPrice) / entryPrice) * 100;
  return side === 'LONG' ? percentChange : -percentChange;
}

/**
 * Validate price
 */
export function isValidPrice(price: number): boolean {
  return price > 0 && Number.isFinite(price);
}

/**
 * Validate quantity
 */
export function isValidQuantity(qty: number): boolean {
  return qty > 0 && Number.isFinite(qty);
}

/**
 * Generate unique ID
 */
export function generateId(prefix: string = 'id'): string {
  const randomHex = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${Date.now()}-${randomHex}`;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get formatted datetime
 */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Parse datetime string to timestamp
 */
export function parseDateTime(dateStr: string): number {
  return new Date(dateStr).getTime();
}

/**
 * Calculate RSI from prices
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
}

/**
 * Calculate simple moving average
 */
export function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return 0;
  const sum = values.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * Calculate EMA
 */
export function calculateEMA(values: number[], period: number): number {
  if (values.length < period) return 0;

  let sma = 0;
  for (let i = 0; i < period; i++) {
    sma += values[values.length - period + i];
  }
  sma = sma / period;

  const multiplier = 2 / (period + 1);
  let ema = sma;

  for (let i = values.length - period + 1; i < values.length; i++) {
    ema = values[i] * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

/**
 * Calculate ATR (Average True Range)
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (highs.length < period) return 0;

  const trueRanges: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const highLow = highs[i] - lows[i];
    const highClose = Math.abs(highs[i] - closes[i - 1]);
    const lowClose = Math.abs(lows[i] - closes[i - 1]);

    trueRanges.push(Math.max(highLow, highClose, lowClose));
  }

  if (trueRanges.length === 0) return 0;

  let atr = 0;
  for (let i = 0; i < Math.min(period, trueRanges.length); i++) {
    atr += trueRanges[i];
  }
  atr = atr / period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

/**
 * Round to nearest interval timestamp
 */
export function roundToInterval(timestamp: number, interval: string): number {
  const intervalMs = INTERVALS_MS[interval as keyof typeof INTERVALS_MS];
  if (!intervalMs) return timestamp;
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

/**
 * Check if price breaks level
 */
export function checkBreakout(price: number, breakoutLevel: number, side: 'LONG' | 'SHORT'): boolean {
  if (side === 'LONG') {
    return price > breakoutLevel;
  } else {
    return price < breakoutLevel;
  }
}

/**
 * Calculate Sharpe Ratio
 */
export function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0): number {
  if (returns.length === 0) return 0;

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;
  return (avgReturn - riskFreeRate) / stdDev;
}

/**
 * Calculate max drawdown
 */
export function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length === 0) return 0;

  let maxDrawdown = 0;
  let peak = equityCurve[0];

  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
    }
    const drawdown = (peak - equityCurve[i]) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}
