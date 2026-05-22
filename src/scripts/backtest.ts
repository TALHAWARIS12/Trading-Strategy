import axios from 'axios';
import { ExecutionEngine } from '@/execution';
import { ETHStrategy } from '@/strategies';
import { Portfolio } from '@/portfolio';
import { Candle } from '@/types';
import logger from '@/logging';
import { config } from '@/config';
import { database } from '@/database';

/**
 * Simple backtesting engine for historical analysis
 * Note: This is a basic implementation for demonstration
 * For production backtesting, use dedicated tools
 */
class BacktestEngine {
  private executionEngine: ExecutionEngine;
  private strategy: ETHStrategy;
  private portfolio: Portfolio;

  constructor() {
    this.executionEngine = new ExecutionEngine(config.paperBalance);
    this.strategy = new ETHStrategy(
      {
        pair: 'ETHUSDT',
        riskPercent: config.riskPercent,
        riskRewardRatio: config.riskRewardRatio,
        atrMultiplier: config.atrMultiplier,
      },
      this.executionEngine
    );
    this.portfolio = new Portfolio(this.executionEngine);
  }

  /**
   * Fetch real historical candles from Binance API
   */
  async fetchRealCandles(symbol: string, interval: string, limit: number, endTime: number): Promise<Candle[]> {
    logger.info(`Fetching ${limit} real ${interval} candles for ${symbol} from Binance API...`);
    const response = await axios.get(`https://api.binance.com/api/v3/klines`, {
      params: {
        symbol,
        interval,
        limit,
        endTime,
      },
    });

    return response.data.map((k: any) => ({
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
  }

  /**
   * Run backtest
   */
  async runBacktest(): Promise<void> {
    try {
      logger.info('Starting backtest...');
      await database.initialize();
      logger.info(`Initial balance: ${config.paperBalance}`);

      const endTime = Math.floor(Date.now() / 60000) * 60000;

      // Fetch real candles
      const candles1m = await this.fetchRealCandles('ETHUSDT', '1m', 1000, endTime);
      const candles5m = await this.fetchRealCandles('ETHUSDT', '5m', 200, endTime);
      const candles15m = await this.fetchRealCandles('ETHUSDT', '15m', 67, endTime);

      logger.info(`Fetched ${candles1m.length} 1m candles`);
      logger.info(`Fetched ${candles5m.length} 5m candles`);
      logger.info(`Fetched ${candles15m.length} 15m candles`);

      // Process each 5m candle through the strategy
      let processedCount = 0;
      for (let i = 0; i < candles5m.length; i++) {
        const candle5m = candles5m[i];
        const currentPrice = candle5m.close;

        // Get candles up to this point
        const slice1m = candles1m.slice(
          0,
          Math.floor((candles1m.length / candles5m.length) * i)
        );
        const slice5m = candles5m.slice(0, i + 1);
        const slice15m = candles15m.slice(0, Math.ceil((candles15m.length / candles5m.length) * i));

        // Process through strategy
        const signals = await this.strategy.processCandle(slice1m, slice5m, slice15m, currentPrice);

        if (signals.length > 0) {
          logger.info(`Signal generated: ${signals[0].type} at ${currentPrice}`);
        }

        // Record equity
        this.portfolio.recordEquity();
        processedCount++;
      }

      logger.info(`Processed ${processedCount} candles`);

      // Get final results
      const metrics = this.executionEngine.getPerformanceMetrics();
      const currentPrices = new Map([['ETHUSDT', candles5m[candles5m.length - 1].close]]);
      const portfolioMetrics = this.portfolio.getMetrics(currentPrices);

      logger.info('');
      logger.info('=== BACKTEST RESULTS ===');
      logger.info(`Final Balance: ${portfolioMetrics.totalBalance}`);
      logger.info(`Total PnL: ${portfolioMetrics.totalPnL} (${portfolioMetrics.totalPnLPercent}%)`);
      logger.info(`Total Trades: ${metrics.totalTrades}`);
      logger.info(`Closed Trades: ${metrics.closedTrades}`);
      logger.info(`Win Rate: ${metrics.winRate}%`);
      logger.info(`Max Drawdown: ${portfolioMetrics.maxDrawdown}%`);
      logger.info(`Sharpe Ratio: ${portfolioMetrics.sharpeRatio}`);
      logger.info('');

      if (metrics.closedTrades > 0) {
        logger.info('Trade Statistics:');
        logger.info(`  Winning Trades: ${metrics.winningTrades}`);
        logger.info(`  Losing Trades: ${metrics.losingTrades}`);
        logger.info(`  Avg Win: ${metrics.avgWin}`);
        logger.info(`  Avg Loss: ${metrics.avgLoss}`);
        logger.info(`  Profit Factor: ${metrics.profitFactor}`);
      }

      logger.info('Backtest completed');
      await database.close();
    } catch (error) {
      logger.error(`Backtest failed: ${error}`);
      await database.close().catch(() => {});
      process.exit(1);
    }
  }
}

// Run backtest
const backtest = new BacktestEngine();
backtest.runBacktest();
