import sqlite3 from 'sqlite3';
import { config } from '@/config';
import logger from '@/logging';
import { DB_TABLES } from '@/constants';
import { Trade, Candle, Signal, PortfolioMetrics } from '@/types';

class Database {
  private db: sqlite3.Database | null = null;
  private isInitialized = false;

  private async dbRun(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      this.db.run(sql, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async dbAll(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(config.databasePath, async (err) => {
        if (err) {
          logger.error(`Failed to connect to database: ${err.message}`);
          reject(err);
          return;
        }

        try {
          await this.createTables();
          this.isInitialized = true;
          logger.info(`Database initialized at ${config.databasePath}`);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const run = (sql: string, params: any[] = []) => this.dbRun(sql, params);

    // Trades table
    await run(`
      CREATE TABLE IF NOT EXISTS ${DB_TABLES.TRADES} (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        side TEXT NOT NULL,
        entryPrice REAL NOT NULL,
        entryQty REAL NOT NULL,
        entryTime INTEGER NOT NULL,
        stopLoss REAL NOT NULL,
        takeProfit1 REAL NOT NULL,
        takeProfit2 REAL NOT NULL,
        status TEXT NOT NULL,
        exitPrice REAL,
        exitTime INTEGER,
        pnl REAL,
        pnlPercent REAL,
        exitReason TEXT,
        createdAt INTEGER DEFAULT (strftime('%s','now') * 1000),
        updatedAt INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);

    // Candles table
    await run(`
      CREATE TABLE IF NOT EXISTS ${DB_TABLES.CANDLES} (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        interval TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        isClosed INTEGER DEFAULT 0,
        createdAt INTEGER DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(pair, interval, timestamp)
      )
    `);

    // Signals table
    await run(`
      CREATE TABLE IF NOT EXISTS ${DB_TABLES.SIGNALS} (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        type TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        confidence REAL NOT NULL,
        reason TEXT NOT NULL,
        createdAt INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);

    // Positions table
    await run(`
      CREATE TABLE IF NOT EXISTS ${DB_TABLES.POSITIONS} (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        side TEXT NOT NULL,
        qty REAL NOT NULL,
        entryPrice REAL NOT NULL,
        entryTime INTEGER NOT NULL,
        currentPrice REAL NOT NULL,
        pnl REAL NOT NULL,
        pnlPercent REAL NOT NULL,
        stopLoss REAL NOT NULL,
        takeProfit1 REAL NOT NULL,
        takeProfit2 REAL NOT NULL,
        isClosed INTEGER DEFAULT 0,
        createdAt INTEGER DEFAULT (strftime('%s','now') * 1000),
        updatedAt INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);

    // Portfolio history table
    await run(`
      CREATE TABLE IF NOT EXISTS ${DB_TABLES.PORTFOLIO_HISTORY} (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        totalBalance REAL NOT NULL,
        availableBalance REAL NOT NULL,
        unrealizedPnL REAL NOT NULL,
        realizedPnL REAL NOT NULL,
        totalPnL REAL NOT NULL,
        createdAt INTEGER DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(timestamp)
      )
    `);

    // Strategy state table
    await run(`
      CREATE TABLE IF NOT EXISTS ${DB_TABLES.STRATEGY_STATE} (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        interval TEXT NOT NULL,
        rangeHigh REAL NOT NULL,
        rangeLow REAL NOT NULL,
        rangeSize REAL NOT NULL,
        rangeTimestamp INTEGER NOT NULL,
        tradeTaken INTEGER DEFAULT 0,
        lastSignalType TEXT,
        lastCandleTimestamp INTEGER NOT NULL,
        updatedAt INTEGER DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(pair, interval)
      )
    `);

    // Logs table
    await run(`
      CREATE TABLE IF NOT EXISTS ${DB_TABLES.LOGS} (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        createdAt INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);

    // Create indices for faster queries
    await run(`CREATE INDEX IF NOT EXISTS idx_trades_pair ON ${DB_TABLES.TRADES}(pair)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_trades_status ON ${DB_TABLES.TRADES}(status)`);
    await run(
      `CREATE INDEX IF NOT EXISTS idx_candles_pair_interval ON ${DB_TABLES.CANDLES}(pair, interval)`
    );
    await run(
      `CREATE INDEX IF NOT EXISTS idx_signals_pair ON ${DB_TABLES.SIGNALS}(pair)`
    );
    await run(
      `CREATE INDEX IF NOT EXISTS idx_positions_pair ON ${DB_TABLES.POSITIONS}(pair)`
    );

    logger.info('Database tables created');
  }

  async insertTrade(trade: Trade): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const run = (sql: string, params: any[] = []) => this.dbRun(sql, params);

    await run(
      `INSERT OR REPLACE INTO ${DB_TABLES.TRADES} 
      (id, pair, side, entryPrice, entryQty, entryTime, stopLoss, takeProfit1, takeProfit2, status, exitPrice, exitTime, pnl, pnlPercent, exitReason, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trade.id,
        trade.pair,
        trade.side,
        trade.entryPrice,
        trade.entryQty,
        trade.entryTime,
        trade.stopLoss,
        trade.takeProfit1,
        trade.takeProfit2,
        trade.status,
        trade.exitPrice,
        trade.exitTime,
        trade.pnl,
        trade.pnlPercent,
        trade.exitReason,
        Date.now(),
      ]
    );
  }

  async insertCandle(candle: Candle): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const run = (sql: string, params: any[] = []) => this.dbRun(sql, params);
    const id = `${candle.pair}-${candle.interval}-${candle.timestamp}`;

    await run(
      `INSERT OR REPLACE INTO ${DB_TABLES.CANDLES}
      (id, pair, interval, timestamp, open, high, low, close, volume, isClosed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        candle.pair,
        candle.interval,
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.isClosed ? 1 : 0,
      ]
    );
  }

  async insertSignal(signal: Signal): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const run = (sql: string, params: any[] = []) => this.dbRun(sql, params);

    await run(
      `INSERT INTO ${DB_TABLES.SIGNALS}
      (id, pair, type, price, timestamp, confidence, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `${Date.now()}-${signal.pair}`,
        signal.pair,
        signal.type,
        signal.price,
        signal.timestamp,
        signal.confidence,
        signal.reason,
      ]
    );
  }

  async getSignals(pair?: string, limit: number = 100): Promise<Signal[]> {
    if (!this.db) throw new Error('Database not initialized');

    const all = (sql: string, params: any[] = []) => this.dbAll(sql, params);

    let query = `SELECT * FROM ${DB_TABLES.SIGNALS}`;
    const params: any[] = [];

    if (pair) {
      query += ` WHERE pair = ?`;
      params.push(pair);
    }

    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = await all(query, params);

    return rows.map((row: any) => ({
      pair: row.pair,
      type: row.type as any,
      price: row.price,
      timestamp: row.timestamp,
      confidence: row.confidence,
      reason: row.reason,
      relatedCandles: [],
    }));
  }

  async getOpenTrades(): Promise<Trade[]> {
    if (!this.db) throw new Error('Database not initialized');

    const all = (sql: string, params: any[] = []) => this.dbAll(sql, params);

    const rows = await all(
      `SELECT * FROM ${DB_TABLES.TRADES} WHERE status IN ('OPEN', 'TP1_PARTIAL_CLOSE')`
    );

    return rows.map((row: any) => ({
      id: row.id,
      pair: row.pair,
      side: row.side,
      entryPrice: row.entryPrice,
      entryQty: row.entryQty,
      entryTime: row.entryTime,
      stopLoss: row.stopLoss,
      takeProfit1: row.takeProfit1,
      takeProfit2: row.takeProfit2,
      status: row.status,
      exitPrice: row.exitPrice,
      exitTime: row.exitTime,
      pnl: row.pnl,
      pnlPercent: row.pnlPercent,
      exitReason: row.exitReason,
    }));
  }

  async getClosedTrades(): Promise<Trade[]> {
    if (!this.db) throw new Error('Database not initialized');

    const all = (sql: string, params: any[] = []) => this.dbAll(sql, params);

    const rows = await all(
      `SELECT * FROM ${DB_TABLES.TRADES} WHERE status = 'CLOSED' ORDER BY exitTime DESC`
    );

    return rows.map((row: any) => ({
      id: row.id,
      pair: row.pair,
      side: row.side,
      entryPrice: row.entryPrice,
      entryQty: row.entryQty,
      entryTime: row.entryTime,
      stopLoss: row.stopLoss,
      takeProfit1: row.takeProfit1,
      takeProfit2: row.takeProfit2,
      status: row.status,
      exitPrice: row.exitPrice,
      exitTime: row.exitTime,
      pnl: row.pnl,
      pnlPercent: row.pnlPercent,
      exitReason: row.exitReason,
    }));
  }

  async getCandles(
    pair: string,
    interval: string,
    limit: number = 500
  ): Promise<Candle[]> {
    if (!this.db) throw new Error('Database not initialized');

    const all = (sql: string, params: any[] = []) => this.dbAll(sql, params);

    const rows = await all(
      `SELECT * FROM ${DB_TABLES.CANDLES} 
      WHERE pair = ? AND interval = ? 
      ORDER BY timestamp DESC 
      LIMIT ?`,
      [pair, interval, limit]
    );

    return rows
      .reverse()
      .map((row: any) => ({
        pair: row.pair,
        interval: row.interval,
        timestamp: row.timestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        isClosed: row.isClosed === 1,
      }));
  }

  async savePortfolioMetrics(pair: string, metrics: PortfolioMetrics): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const run = (sql: string, params: any[] = []) => this.dbRun(sql, params);

    await run(
      `INSERT INTO ${DB_TABLES.PORTFOLIO_HISTORY}
      (id, timestamp, totalBalance, availableBalance, unrealizedPnL, realizedPnL, totalPnL)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `${pair}-${Date.now()}`,
        Date.now(),
        metrics.totalBalance,
        metrics.availableBalance,
        metrics.unrealizedPnL,
        metrics.realizedPnL,
        metrics.totalPnL,
      ]
    );
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else {
            this.db = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  isReady(): boolean {
    return this.isInitialized && this.db !== null;
  }
}

export const database = new Database();
