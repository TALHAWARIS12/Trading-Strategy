import { Candle, IndicatorValues } from '@/types';
import { INDICATORS } from '@/constants';
import { calculateEMA, calculateSMA, calculateATR, calculateRSI } from '@/utils';

export class IndicatorCalculator {
  /**
   * Calculate EMA for a candle buffer
   */
  static calculateEMA(candles: Candle[], period: number, priceType: 'close' | 'high' | 'low' = 'close'): number {
    if (candles.length < period) return 0;

    const prices = candles.map((c) => {
      switch (priceType) {
        case 'high':
          return c.high;
        case 'low':
          return c.low;
        default:
          return c.close;
      }
    });

    return calculateEMA(prices, period);
  }

  /**
   * Calculate SMA for a candle buffer
   */
  static calculateSMA(candles: Candle[], period: number, priceType: 'close' | 'high' | 'low' = 'close'): number {
    if (candles.length < period) return 0;

    const prices = candles.map((c) => {
      switch (priceType) {
        case 'high':
          return c.high;
        case 'low':
          return c.low;
        default:
          return c.close;
      }
    });

    return calculateSMA(prices, period);
  }

  /**
   * Calculate ATR for a candle buffer
   */
  static calculateATR(candles: Candle[], period: number = INDICATORS.ATR_PERIOD): number {
    if (candles.length < period + 1) return 0;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    return calculateATR(highs, lows, closes, period);
  }

  /**
   * Calculate RSI for a candle buffer
   */
  static calculateRSI(candles: Candle[], period: number = INDICATORS.RSI_PERIOD): number {
    if (candles.length < period + 1) return 50;

    const prices = candles.map((c) => c.close);
    return calculateRSI(prices, period);
  }

  /**
   * Calculate Bollinger Bands
   */
  static calculateBollingerBands(
    candles: Candle[],
    period: number = INDICATORS.BB_PERIOD,
    stdDev: number = INDICATORS.BB_STDDEV
  ): { upper: number; middle: number; lower: number } | undefined {
    if (candles.length < period) return undefined;

    const prices = candles.slice(-period).map((c) => c.close);
    const sma = calculateSMA(prices, period);

    const variance = prices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    return {
      middle: sma,
      upper: sma + standardDeviation * stdDev,
      lower: sma - standardDeviation * stdDev,
    };
  }

  /**
   * Calculate MACD
   */
  static calculateMACD(candles: Candle[]): { macdLine: number; signalLine: number; histogram: number } | undefined {
    if (candles.length < INDICATORS.MACD_SLOW + INDICATORS.MACD_SIGNAL) return undefined;

    const closes = candles.map((c) => c.close);
    const ema12 = calculateEMA(closes, INDICATORS.MACD_FAST);
    const ema26 = calculateEMA(closes, INDICATORS.MACD_SLOW);

    const macdLine = ema12 - ema26;

    // Calculate signal line (EMA of MACD)
    let signalLine = 0;
    if (candles.length >= INDICATORS.MACD_SLOW + INDICATORS.MACD_SIGNAL) {
      // Build MACD line array for the last MACD_SIGNAL periods
      const macdLines: number[] = [];
      for (let i = Math.max(0, closes.length - INDICATORS.MACD_SIGNAL - 10); i < closes.length; i++) {
        const sliceCloses = closes.slice(0, i + 1);
        if (sliceCloses.length >= INDICATORS.MACD_SLOW) {
          const e12 = calculateEMA(sliceCloses, INDICATORS.MACD_FAST);
          const e26 = calculateEMA(sliceCloses, INDICATORS.MACD_SLOW);
          macdLines.push(e12 - e26);
        }
      }

      if (macdLines.length >= INDICATORS.MACD_SIGNAL) {
        signalLine = calculateEMA(macdLines, INDICATORS.MACD_SIGNAL);
      }
    }

    const histogram = macdLine - signalLine;

    return {
      macdLine,
      signalLine,
      histogram,
    };
  }

  /**
   * Calculate all indicators at once
   */
  static calculateAllIndicators(candles: Candle[]): IndicatorValues {
    const indicators: IndicatorValues = {};

    if (candles.length >= INDICATORS.EMA_50_PERIOD) {
      indicators.ema50 = this.calculateEMA(candles, INDICATORS.EMA_50_PERIOD);
    }

    if (candles.length >= INDICATORS.EMA_200_PERIOD) {
      indicators.ema200 = this.calculateEMA(candles, INDICATORS.EMA_200_PERIOD);
    }

    if (candles.length >= INDICATORS.ATR_PERIOD + 1) {
      indicators.atr = this.calculateATR(candles, INDICATORS.ATR_PERIOD);
    }

    if (candles.length >= INDICATORS.ATR_SMA_PERIOD) {
      // Calculate ATR SMA (SMA of last ATR_SMA_PERIOD ATR values)
      const atrValues: number[] = [];
      for (let i = Math.max(0, candles.length - INDICATORS.ATR_SMA_PERIOD - 20); i <= candles.length - 1; i++) {
        const slice = candles.slice(0, i + 1);
        if (slice.length >= INDICATORS.ATR_PERIOD + 1) {
          atrValues.push(this.calculateATR(slice, INDICATORS.ATR_PERIOD));
        }
      }

      if (atrValues.length >= INDICATORS.ATR_SMA_PERIOD) {
        indicators.atrSma = calculateSMA(atrValues, INDICATORS.ATR_SMA_PERIOD);
      }
    }

    if (candles.length >= INDICATORS.RSI_PERIOD + 1) {
      indicators.rsi = this.calculateRSI(candles, INDICATORS.RSI_PERIOD);
    }

    if (candles.length >= INDICATORS.BB_PERIOD) {
      indicators.bb20 = this.calculateBollingerBands(candles, INDICATORS.BB_PERIOD);
    }

    if (candles.length >= INDICATORS.MACD_SLOW + INDICATORS.MACD_SIGNAL) {
      indicators.macd = this.calculateMACD(candles);
    }

    return indicators;
  }

  /**
   * Check if trend is bullish (for 15m)
   */
  static isBullishTrend(candles: Candle[]): boolean {
    if (candles.length < INDICATORS.EMA_200_PERIOD) return false;

    const ema50 = this.calculateEMA(candles, INDICATORS.EMA_50_PERIOD);
    const ema200 = this.calculateEMA(candles, INDICATORS.EMA_200_PERIOD);

    return ema50 > ema200;
  }

  /**
   * Check if trend is bearish (for 15m)
   */
  static isBearishTrend(candles: Candle[]): boolean {
    if (candles.length < INDICATORS.EMA_200_PERIOD) return false;

    const ema50 = this.calculateEMA(candles, INDICATORS.EMA_50_PERIOD);
    const ema200 = this.calculateEMA(candles, INDICATORS.EMA_200_PERIOD);

    return ema50 < ema200;
  }

  /**
   * Check if volatility is high enough for trading
   */
  static isVolatilityHigh(atr: number, atrSma: number): boolean {
    if (atrSma === 0) return false;
    return atr > atrSma;
  }

  /**
   * Check if price is in overbought territory (RSI > 70)
   */
  static isOverbought(rsi: number): boolean {
    return rsi > INDICATORS.RSI_OVERBOUGHT;
  }

  /**
   * Check if price is in oversold territory (RSI < 30)
   */
  static isOversold(rsi: number): boolean {
    return rsi < INDICATORS.RSI_OVERSOLD;
  }
}
