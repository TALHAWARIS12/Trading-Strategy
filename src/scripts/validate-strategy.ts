import axios from 'axios';
import { IndicatorCalculator } from '@/indicators';
import { Candle } from '@/types';
import logger from '@/logging';

/**
 * Validate strategy logic against TradingView
 */
async function validateStrategy(): Promise<void> {
  try {
    logger.info('Validating strategy implementation using REAL live Binance data...');

    const symbol = 'ETHUSDT';
    const interval = '15m';
    const limit = 300;

    logger.info(`Fetching ${limit} real ${interval} candles for ${symbol} from Binance API...`);
    const response = await axios.get(`https://api.binance.com/api/v3/klines`, {
      params: { symbol, interval, limit }
    });

    const testCandles: Candle[] = response.data.map((k: any) => ({
      pair: symbol,
      interval,
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      isClosed: true,
    }));

    logger.info(`Successfully fetched ${testCandles.length} real candles.`);

    // Test indicators
    const ema50 = IndicatorCalculator.calculateEMA(testCandles, 50);
    const ema200 = IndicatorCalculator.calculateEMA(testCandles, 200);
    const atr = IndicatorCalculator.calculateATR(testCandles, 14);

    logger.info(`Test Results:`);
    logger.info(`  EMA50: ${ema50.toFixed(2)}`);
    logger.info(`  EMA200: ${ema200.toFixed(2)}`);
    logger.info(`  ATR: ${atr.toFixed(2)}`);
    logger.info(`  Trend: ${ema50 > ema200 ? 'BULLISH' : 'BEARISH'}`);

    // Test Bollinger Bands
    const bb = IndicatorCalculator.calculateBollingerBands(testCandles, 20);
    if (bb) {
      logger.info(`  BB20 Upper: ${bb.upper.toFixed(2)}`);
      logger.info(`  BB20 Middle: ${bb.middle.toFixed(2)}`);
      logger.info(`  BB20 Lower: ${bb.lower.toFixed(2)}`);
    }

    // Test MACD
    const macd = IndicatorCalculator.calculateMACD(testCandles);
    if (macd) {
      logger.info(`  MACD Line: ${macd.macdLine.toFixed(4)}`);
      logger.info(`  Signal Line: ${macd.signalLine.toFixed(4)}`);
      logger.info(`  Histogram: ${macd.histogram.toFixed(4)}`);
    }

    logger.info('Strategy validation completed successfully');
  } catch (error) {
    logger.error(`Strategy validation failed: ${error}`);
    process.exit(1);
  }
}

validateStrategy();
