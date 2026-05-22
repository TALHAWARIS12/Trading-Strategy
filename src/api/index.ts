import express, { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { ExecutionEngine } from '@/execution';
import { Portfolio } from '@/portfolio';
import { ETHStrategy, BTCStrategy } from '@/strategies';
import { HealthMonitor } from '@/monitoring';
import { candleBuilder } from '@/candles';
import { wsManager } from '@/websocket';
import logger from '@/logging';
import { database } from '@/database';
import { start, stop } from '@/app';

export interface APIServerConfig {
  port: number;
  executionEngine: ExecutionEngine;
  portfolio: Portfolio;
  ethStrategy: ETHStrategy;
  btcStrategy: BTCStrategy;
  healthMonitor: HealthMonitor;
}

export class APIServer {
  private router: Router;
  private config: APIServerConfig;
  private app: express.Application | null = null;

  constructor(config: APIServerConfig) {
    this.config = config;
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check
    this.router.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
      });
    });

    // Get current positions
    this.router.get('/positions', (req, res) => {
      try {
        const currentPrices = this.getCurrentPrices();
        const positions = this.config.portfolio.getPositions(currentPrices);
        res.json({
          positions,
          count: positions.length,
        });
      } catch (error) {
        logger.error(`Error getting positions: ${error}`);
        res.status(500).json({ error: 'Failed to get positions' });
      }
    });

    // Get trade history
    this.router.get('/trades', (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 100;
        const closedTrades = this.config.executionEngine.getClosedTrades().slice(-limit);
        res.json({
          trades: closedTrades,
          count: closedTrades.length,
        });
      } catch (error) {
        logger.error(`Error getting trades: ${error}`);
        res.status(500).json({ error: 'Failed to get trades' });
      }
    });

    // Get AI reasoning for a trade
    this.router.get('/trades/:id/reasoning', async (req, res) => {
      try {
        const tradeId = req.params.id;
        
        // Find trade
        let trade = this.config.executionEngine.getOpenTrade(tradeId);
        if (!trade) {
          trade = this.config.executionEngine.getClosedTrades().find(t => t.id === tradeId) || null;
        }

        if (!trade) {
          return res.status(404).json({ error: 'Trade not found' });
        }

        const { AIReasoningService } = await import('@/services/ai-reasoning');
        const reasoning = await AIReasoningService.generateTradeReasoning(trade);
        
        res.json({
          tradeId,
          reasoning,
        });
      } catch (error) {
        logger.error(`Error generating trade reasoning: ${error}`);
        res.status(500).json({ error: 'Failed to generate trade reasoning' });
      }
    });

    // Get signals
    this.router.get('/signals', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 100;
        const pair = req.query.pair as string;
        const signals = await database.getSignals(pair, limit);
        res.json({
          signals,
          count: signals.length,
        });
      } catch (error) {
        logger.error(`Error getting signals: ${error}`);
        res.status(500).json({ error: 'Failed to get signals' });
      }
    });

    // Get performance metrics
    this.router.get('/performance', (req, res) => {
      try {
        const currentPrices = this.getCurrentPrices();
        const metrics = this.config.portfolio.getMetrics(currentPrices);
        res.json(metrics);
      } catch (error) {
        logger.error(`Error getting performance: ${error}`);
        res.status(500).json({ error: 'Failed to get performance' });
      }
    });

    // Get candles
    this.router.get('/candles', (req, res) => {
      try {
        const pair = req.query.pair as string || 'ETHUSDT';
        const interval = req.query.interval as string || '5m';
        const limit = parseInt(req.query.limit as string) || 100;

        const candles = candleBuilder.getCandles(pair, interval, limit);
        res.json({
          pair,
          interval,
          candles,
          count: candles.length,
        });
      } catch (error) {
        logger.error(`Error getting candles: ${error}`);
        res.status(500).json({ error: 'Failed to get candles' });
      }
    });

    // Get system status
    this.router.get('/status', (_req, res) => {
      try {
        const connectedPairs = Object.keys(wsManager.getConnectionStatus());
        const openTrades = this.config.executionEngine.getOpenTrades();
        const currentPrices = this.getCurrentPrices();
        const metrics = this.config.portfolio.getMetrics(currentPrices);

        const status = this.config.healthMonitor.getStatus(
          true,
          connectedPairs,
          openTrades.length,
          metrics.totalBalance
        );

        res.json(status);
      } catch (error) {
        logger.error(`Error getting status: ${error}`);
        res.status(500).json({ error: 'Failed to get status' });
      }
    });

    // Start bot
    this.router.post('/start-bot', async (_req, res) => {
      try {
        await start();
        res.json({
          message: 'Bot started successfully',
          status: 'running',
        });
      } catch (error) {
        logger.error(`Error starting bot: ${error}`);
        res.status(500).json({ error: 'Failed to start bot' });
      }
    });

    // Stop bot
    this.router.post('/stop-bot', async (_req, res) => {
      try {
        await stop();
        res.json({
          message: 'Bot stopped successfully',
          status: 'stopped',
        });
      } catch (error) {
        logger.error(`Error stopping bot: ${error}`);
        res.status(500).json({ error: 'Failed to stop bot' });
      }
    });

    // Reset paper account
    this.router.post('/reset-paper-account', (req, res) => {
      try {
        const newBalance = parseFloat(req.body?.balance) || 10000;
        this.config.executionEngine.reset(newBalance);
        this.config.portfolio.reset();
        this.config.ethStrategy.reset();
        this.config.btcStrategy.reset();

        res.json({
          message: 'Paper account reset successfully',
          newBalance,
        });
      } catch (error) {
        logger.error(`Error resetting paper account: ${error}`);
        res.status(500).json({ error: 'Failed to reset paper account' });
      }
    });

    // Get logs
    this.router.get('/logs', (_req, res) => {
      try {
        const logFile = path.join(process.cwd(), 'logs', 'combined.log');
        if (!fs.existsSync(logFile)) {
          return res.json({ logs: [], message: 'No log file found yet.' });
        }
        const data = fs.readFileSync(logFile, 'utf-8');
        const lines = data.split('\n').filter(line => line.trim() !== '').slice(-100);
        res.json({
          logs: lines,
          count: lines.length,
        });
      } catch (error) {
        logger.error(`Error getting logs: ${error}`);
        res.status(500).json({ error: 'Failed to get logs' });
      }
    });
  }

  private getCurrentPrices(): Map<string, number> {
    const prices = new Map<string, number>();

    // Get latest prices from candle builder
    const pairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    for (const pair of pairs) {
      const candle5m = candleBuilder.getLatestCandle(pair, '5m');
      if (candle5m) {
        prices.set(pair, candle5m.close);
      }
    }

    return prices;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      const app = express();

      // Middleware
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));

      // Serve static files from public directory
      app.use(express.static(path.join(process.cwd(), 'public')));

      // CORS
      app.use((_req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        next();
      });

      // Routes
      app.use('/api', this.router);

      // Health check
      app.get('/', (_req, res) => {
        res.json({ status: 'ok', service: 'crypto-trading-bot' });
      });

      // 404 handler
      app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
      });

      // Start server
      app.listen(this.config.port, () => {
        logger.info(`API server started on port ${this.config.port}`);
        this.app = app;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Express doesn't have a built-in stop method, but this is here for API consistency
    logger.info('API server stop requested');
  }
}
