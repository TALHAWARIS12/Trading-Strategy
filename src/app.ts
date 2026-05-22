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

    const streams: string[] = [];

    for (const pair of config.tradingPairs) {
      for (const interval of config.intervals) {
        streams.push(`${pair.toLowerCase()}@kline_${interval}`);
      }
    }

    wsClient = wsManager.createClient('main', streams);

    // Pass ALL kline events (open and closed) to candleBuilder so that:
    // - Partial (in-progress) candles are stored for live price tracking
    // - Closed candles are added to the buffer for strategy use
    wsClient.on('kline', (data: any) => {
      const klineData = data as KlineData;
      const candle = candleBuilder.processKline(klineData);
      if (candle) {
        logger.debug(
          `Candle closed: ${candle.pair} ${candle.interval} @ ${new Date(candle.timestamp).toISOString()}`
        );
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
 * Main processing loop — runs every 5 seconds
 */
async function processingLoop(): Promise<void> {
  let loopCounter = 0;

  updateInterval = setInterval(async () => {
    try {
      loopCounter++;
      const shouldLogStatus = loopCounter % 60 === 0;

      if (shouldLogStatus) {
        logger.info(`⏱️ Processing loop tick #${loopCounter} - checking for trading signals...`);
      }

      // ── BTC Strategy ───────────────────────────────────────────────────────
      if (config.btcEnabled && config.tradingPairs.includes('BTCUSDT')) {
        // BTC strategy uses 1m candles for range detection (matches Pine Script)
        const candles1m  = candleBuilder.getCandles('BTCUSDT', '1m', 200);
        const candles15m = candleBuilder.getCandles('BTCUSDT', '15m', 200);

        if (candles1m.length === 0 || candles15m.length === 0) {
          if (shouldLogStatus) {
            logger.debug(`[BTC] Insufficient candles: 1m=${candles1m.length}, 15m=${candles15m.length}`);
          }
        } else {
          // Live price: use latest partial (in-progress) 1m candle close,
          // falling back to last closed 1m candle close
          const partial1m    = candleBuilder.getPartialCandle('BTCUSDT', '1m');
          const currentPrice = partial1m
            ? partial1m.close
            : candles1m[candles1m.length - 1].close;

          if (shouldLogStatus) {
            logger.debug(
              `[BTC] candles1m=${candles1m.length}, candles15m=${candles15m.length}, ` +
              `price=${currentPrice.toFixed(2)} (${partial1m ? 'partial' : 'closed'})`
            );
          }

          const signals = await btcStrategy.processCandle(candles1m, candles15m, currentPrice);

          for (const signal of signals) {
            logger.info(
              `[BTCStrategy] Signal: ${signal.type} for ${signal.pair} @ ${signal.price} - ${signal.reason}`
            );
            await database.insertSignal(signal).catch((err) =>
              logger.error(`Failed to persist BTC signal to database: ${err}`)
            );
          }
        }
      }

      // ── ETH Strategy ───────────────────────────────────────────────────────
      if (config.ethEnabled && config.tradingPairs.includes('ETHUSDT')) {
        const candles1m  = candleBuilder.getCandles('ETHUSDT', '1m', 200);
        const candles5m  = candleBuilder.getCandles('ETHUSDT', '5m', 200);
        const candles15m = candleBuilder.getCandles('ETHUSDT', '15m', 200);

        if (candles5m.length === 0 || candles15m.length === 0) {
          if (shouldLogStatus) {
            logger.debug(`[ETH] Insufficient candles: 1m=${candles1m.length}, 5m=${candles5m.length}, 15m=${candles15m.length}`);
          }
        } else {
          const partial5m    = candleBuilder.getPartialCandle('ETHUSDT', '5m');
          const currentPrice = partial5m
            ? partial5m.close
            : candles5m[candles5m.length - 1].close;

          if (shouldLogStatus) {
            logger.debug(
              `[ETH] candles1m=${candles1m.length}, candles5m=${candles5m.length}, ` +
              `candles15m=${candles15m.length}, price=${currentPrice.toFixed(2)} ` +
              `(${partial5m ? 'partial' : 'closed'})`
            );
          }

          const signals = await ethStrategy.processCandle(candles1m, candles5m, candles15m, currentPrice);

          for (const signal of signals) {
            logger.info(
              `[ETHStrategy] Signal: ${signal.type} for ${signal.pair} @ ${signal.price} - ${signal.reason}`
            );
            await database.insertSignal(signal).catch((err) =>
              logger.error(`Failed to persist ETH signal to database: ${err}`)
            );
          }
        }
      }

      // ── Equity snapshot — once per loop, outside the pair loop ─────────────
      portfolio.recordEquity();

      // ── Health check ───────────────────────────────────────────────────────
      if (!healthMonitor.isSystemHealthy()) {
        logger.warn('System health degraded');
      }
    } catch (error) {
      logger.error(`Processing loop error: ${error}`);
    }
  }, 5000);
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
    await initialize();

    if (!isApiServerStarted) {
      await apiServer.start();
      isApiServerStarted = true;
      logger.info('API server is up — ready to serve health checks');
    }

    healthMonitor.start(30000);
    logger.info('Health monitor started');

    connectWebSocketWithRetry();

    await processingLoop();

    isRunning = true;
    logger.info('✅ Bot startup complete - trading strategy active');

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
      logger.warn(
        `⚠️ WebSocket connection attempt ${attempt} failed: ${err.message} — retrying in ${delay / 1000}s`
      );
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

    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }

    healthMonitor.stop();

    if (apiServer) {
      try {
        await apiServer.stop();
      } catch (err) {
        logger.warn(`Error stopping API server: ${err}`);
      }
    }

    if (executionEngine) {
      try {
        await recoveryManager.saveState(executionEngine);
      } catch (err) {
        logger.warn(`Failed to save state during shutdown: ${err}`);
      }
    }

    if (wsClient) {
      try {
        wsClient.disconnect();
      } catch (err) {
        logger.warn(`Error disconnecting WebSocket: ${err}`);
      }
      wsClient = null;
    }

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

process.on('SIGINT', async () => {
  logger.info('Received SIGINT - shutting down gracefully');
  await stop();
  setTimeout(() => { process.exit(0); }, 2000);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM - shutting down gracefully');
  await stop();
  setTimeout(() => { process.exit(0); }, 2000);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error}`);
  stop().then(() => {
    setTimeout(() => { process.exit(1); }, 1000);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at ${promise}: ${reason}`);
});

(async () => {
  try {
    await start();
    logger.info('Bot is running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  }
})();

export {
  executionEngine,
  portfolio,
  ethStrategy,
  btcStrategy,
  ethStrategy as strategy,
  start,
  stop,
};