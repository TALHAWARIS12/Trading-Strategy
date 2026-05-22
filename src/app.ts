import { config } from '@/config';
import { database } from '@/database';
import { wsManager, BinanceWebSocket } from '@/websocket';
import { candleBuilder, KlineData } from '@/candles';
import { ExecutionEngine } from '@/execution';
import { ETHStrategy, BTCStrategy } from '@/strategies';
import { Portfolio } from '@/portfolio';
import { APIServer } from '@/api';
import { healthMonitor } from '@/monitoring';
import { recoveryManager } from '@/recovery';
import logger from '@/logging';
import { sleep } from '@/utils';

let isRunning = false;
let isInitialized = false;
let isApiServerStarted = false;
let executionEngine: ExecutionEngine;
let portfolio: Portfolio;
let ethStrategy: ETHStrategy;
let btcStrategy: BTCStrategy;
let apiServer: APIServer;
let wsClient: BinanceWebSocket | null = null;
let updateInterval: NodeJS.Timeout | null = null;

/**
 * Initialize the bot
 */
async function initialize(): Promise<void> {
  if (isInitialized) {
    logger.debug('Bot already initialized, skipping initialization.');
    return;
  }
  try {
    logger.info('=== Crypto Paper Trading Bot ===');
    logger.info('Initializing...');

    // Initialize database
    await database.initialize();

    // Initialize execution engine
    executionEngine = new ExecutionEngine(config.paperBalance);
    logger.info(`Paper account initialized with balance: ${config.paperBalance}`);

    // Initialize portfolio
    portfolio = new Portfolio(executionEngine);

    // Initialize ETH strategy
    ethStrategy = new ETHStrategy(
      {
        pair: 'ETHUSDT',
        riskPercent: config.riskPercent,
        riskRewardRatio: config.riskRewardRatio,
        atrMultiplier: config.atrMultiplier,
      },
      executionEngine
    );

    // Initialize BTC strategy
    btcStrategy = new BTCStrategy(
      {
        pair: 'BTCUSDT',
        riskPercent: config.riskPercent,
        riskRewardRatio: config.riskRewardRatio,
      },
      executionEngine
    );

    // Recover state from database
    await recoveryManager.recoverState(executionEngine);
    const { isValid } = await recoveryManager.verifyStateIntegrity(executionEngine);

    if (!isValid) {
      logger.warn('State integrity issues detected - bot will start fresh');
    }

    // Initialize API server
    apiServer = new APIServer({
      port: config.port,
      executionEngine,
      portfolio,
      ethStrategy,
      btcStrategy,
      healthMonitor,
    });

    isInitialized = true;
    logger.info('Bot initialization complete');
  } catch (error) {
    logger.error(`Initialization failed: ${error}`);
    throw error;
  }
}

/**
 * Connect to Binance WebSocket
 */
async function connectWebSocket(): Promise<void> {
  try {
    logger.info('Connecting to Binance WebSocket...');

    // Create WebSocket streams for each pair and interval
    const streams: string[] = [];

    for (const pair of config.tradingPairs) {
      for (const interval of config.intervals) {
        // Format: btcusdt@kline_1m
        streams.push(`${pair.toLowerCase()}@kline_${interval}`);
      }
    }

    wsClient = wsManager.createClient('main', streams);

    wsClient.on('kline', (data: any) => {
      const klineData = data as KlineData;
      if (klineData.k.x) {
        // Closed candle
        const candle = candleBuilder.processKline(klineData);
        if (candle) {
          logger.debug(
            `Candle processed: ${candle.pair} ${candle.interval} @ ${candle.timestamp}`
          );
        }
      }
    });

    wsClient.on('connected', () => {
      logger.info('WebSocket connected');
    });

    wsClient.on('disconnected', () => {
      logger.warn('WebSocket disconnected');
    });

    wsClient.on('error', (error) => {
      logger.error(`WebSocket error: ${error}`);
    });

    await wsClient.connect();
    logger.info('WebSocket connected successfully');
  } catch (error) {
    logger.error(`WebSocket connection failed: ${error}`);
    throw error;
  }
}

/**
 * Main processing loop
 */
async function processingLoop(): Promise<void> {
  let loopCounter = 0;
  updateInterval = setInterval(async () => {
    try {
      loopCounter++;
      // Log every 60 loops (every 5 minutes at 5s intervals) to track activity
      const shouldLogStatus = loopCounter % 60 === 0;
      if (shouldLogStatus) {
        logger.info(`⏱️ Processing loop tick #${loopCounter} - checking for trading signals...`);
      }

      // Process strategy for each pair
      for (const pair of config.tradingPairs) {
        if (pair === 'BTCUSDT') {
          if (!config.btcEnabled) continue;

          const candles3m = candleBuilder.getCandles(pair, '3m', 100);
          const candles15m = candleBuilder.getCandles(pair, '15m', 100);

          if (candles3m.length === 0 || candles15m.length === 0) {
            if (shouldLogStatus) {
              logger.debug(`[BTC] Insufficient candles: 3m=${candles3m.length}, 15m=${candles15m.length}`);
            }
            continue; // Not enough data
          }

          // Use current live price from in-progress candle, fallback to last closed candle
          const partialCandle3m = candleBuilder.getPartialCandle(pair, '3m');
          const currentPrice = partialCandle3m ? partialCandle3m.close : candles3m[candles3m.length - 1].close;

          // Process BTC Strategy
          const signals = await btcStrategy.processCandle(candles3m, candles15m, currentPrice);

          // Log and save signals to database
          for (const signal of signals) {
            logger.info(
              `[BTCStrategy] Signal: ${signal.type} for ${signal.pair} @ ${signal.price} - ${signal.reason}`
            );
            await database.insertSignal(signal).catch((err) =>
              logger.error(`Failed to persist BTC signal to database: ${err}`)
            );
          }
        } else if (pair === 'ETHUSDT') {
          if (!config.ethEnabled) continue;

          const candles1m = candleBuilder.getCandles(pair, '1m', 100);
          const candles5m = candleBuilder.getCandles(pair, '5m', 100);
          const candles15m = candleBuilder.getCandles(pair, '15m', 100);

          if (candles5m.length === 0 || candles15m.length === 0) {
            if (shouldLogStatus) {
              logger.debug(`[ETH] Insufficient candles: 5m=${candles5m.length}, 15m=${candles15m.length}`);
            }
            continue; // Not enough data
          }

          // Use current live price from in-progress candle, fallback to last closed candle
          const partialCandle5m = candleBuilder.getPartialCandle(pair, '5m');
          const currentPrice = partialCandle5m ? partialCandle5m.close : candles5m[candles5m.length - 1].close;

          // Process ETH Strategy
          const signals = await ethStrategy.processCandle(candles1m, candles5m, candles15m, currentPrice);

          // Log and save signals to database
          for (const signal of signals) {
            logger.info(
              `[ETHStrategy] Signal: ${signal.type} for ${signal.pair} @ ${signal.price} - ${signal.reason}`
            );
            await database.insertSignal(signal).catch((err) =>
              logger.error(`Failed to persist ETH signal to database: ${err}`)
            );
          }
        }

        // Record equity snapshot every minute
        portfolio.recordEquity();
      }

      // Check health
      if (!healthMonitor.isSystemHealthy()) {
        logger.warn('System health degraded');
      }
    } catch (error) {
      logger.error(`Processing loop error: ${error}`);
    }
  }, 5000); // Process every 5 seconds
}

/**
 * Start the bot
 */
async function start(): Promise<void> {
  if (isRunning) {
    logger.warn('Bot already running');
    return;
  }

  logger.info('Starting bot...');

  try {
    // Step 1: Initialize core (DB, strategies, portfolio)
    await initialize();

    // Step 2: Start API server IMMEDIATELY so Render health check passes
    if (!isApiServerStarted) {
      await apiServer.start();
      isApiServerStarted = true;
      logger.info('API server is up — ready to serve health checks');
    }

    // Step 3: Start monitoring
    healthMonitor.start(30000);
    logger.info('Health monitor started');

    // Step 4: Connect WebSocket in background — never kill the process on WS failure
    connectWebSocketWithRetry();

    // Step 5: Start the processing loop
    await processingLoop();

    isRunning = true;
    logger.info('✅ Bot startup complete - trading strategy active');

    // Save state periodically
    setInterval(async () => {
      try {
        if (executionEngine) {
          await recoveryManager.saveState(executionEngine);
        }
      } catch (error) {
        logger.warn(`Failed to save state: ${error}`);
      }
    }, 60000);
  } catch (error) {
    logger.error(`Failed to start bot: ${error}`);
    // Only exit if core init failed (DB / API server)
    process.exit(1);
  }
}

/**
 * Connect WebSocket with automatic retry — non-fatal, runs in background
 */
function connectWebSocketWithRetry(attempt = 1): void {
  const maxDelay = 60000;
  const delay = Math.min(5000 * attempt, maxDelay);

  connectWebSocket()
    .then(() => {
      logger.info(`✅ WebSocket connected successfully on attempt ${attempt}`);
    })
    .catch((err) => {
      logger.warn(`⚠️ WebSocket connection attempt ${attempt} failed: ${err.message} — retrying in ${delay / 1000}s`);
      setTimeout(() => connectWebSocketWithRetry(attempt + 1), delay);
    });
}

/**
 * Stop the bot gracefully
 */
async function stop(): Promise<void> {
  try {
    logger.info('Stopping bot...');

    isRunning = false;
    isInitialized = false;

    // Stop processing loop
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }

    // Stop monitoring
    healthMonitor.stop();

    // Stop API server
    if (apiServer) {
      try {
        await apiServer.stop();
      } catch (err) {
        logger.warn(`Error stopping API server: ${err}`);
      }
    }

    // Save state
    if (executionEngine) {
      try {
        await recoveryManager.saveState(executionEngine);
      } catch (err) {
        logger.warn(`Failed to save state during shutdown: ${err}`);
      }
    }

    // Disconnect WebSocket
    if (wsClient) {
      try {
        wsClient.disconnect();
      } catch (err) {
        logger.warn(`Error disconnecting WebSocket: ${err}`);
      }
      wsClient = null;
    }

    // Close database
    try {
      await database.close();
    } catch (err) {
      logger.warn(`Error closing database: ${err}`);
    }

    logger.info('✅ Bot stopped cleanly');
  } catch (error) {
    logger.error(`Error stopping bot: ${error}`);
  }
}

/**
 * Handle process signals
 */
process.on('SIGINT', async () => {
  logger.info('Received SIGINT - shutting down gracefully');
  await stop();
  // Give 2 seconds for cleanup, then force exit
  setTimeout(() => {
    logger.warn('Force exiting after 2 second timeout');
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM - shutting down gracefully');
  await stop();
  // Give 2 seconds for cleanup, then force exit
  setTimeout(() => {
    logger.warn('Force exiting after 2 second timeout');
    process.exit(0);
  }, 2000);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error}`);
  stop().then(async () => {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at ${promise}: ${reason}`);
});

/**
 * Main entry point
 */
(async () => {
  try {
    await start();
    logger.info('Bot is running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  }
})();

export { executionEngine, portfolio, ethStrategy, btcStrategy, ethStrategy as strategy, start, stop };

