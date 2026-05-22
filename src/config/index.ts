import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

export interface Config {
  // API
  binanceApiKey: string;
  binanceApiSecret: string;
  binanceWsUrl: string;

  // Trading
  tradingPairs: string[];
  intervals: string[];
  paperBalance: number;
  riskPercent: number;
  riskRewardRatio: number;
  atrMultiplier: number;

  // Feature flags
  btcEnabled: boolean;
  ethEnabled: boolean;
  solEnabled: boolean;

  // Risk Management
  maxDailyLossPercent: number;
  maxConcurrentTrades: number;

  // Database
  databasePath: string;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logPath: string;

  // Server
  port: number;
  nodeEnv: 'development' | 'production' | 'test';

  // Backtesting
  backtestStartDate: string;
  backtestEndDate: string;
  backtestPair: string;

  // AI Reasoning
  openaiApiKey: string;
  openaiModel: string;
}

function getConfig(): Config {
  // Ensure data and logs directories exist
  const dataDir = process.env.DATABASE_PATH?.split('/')[0] || './data';
  const logsDir = process.env.LOG_PATH || './logs';

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const config: Config = {
    binanceApiKey: process.env.BINANCE_API_KEY || '',
    binanceApiSecret: process.env.BINANCE_API_SECRET || '',
    binanceWsUrl: process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws',

    tradingPairs: (process.env.TRADING_PAIRS || 'BTCUSDT,ETHUSDT,SOLUSDT')
      .split(',')
      .map(p => p.trim()),
    intervals: (process.env.INTERVALS || '1m,5m,15m').split(',').map(i => i.trim()),
    paperBalance: parseFloat(process.env.PAPER_BALANCE || '10000'),
    riskPercent: parseFloat(process.env.RISK_PERCENT || '1'),
    riskRewardRatio: parseFloat(process.env.RISK_REWARD_RATIO || '2'),
    atrMultiplier: parseFloat(process.env.ATR_MULTIPLIER || '1.5'),

    btcEnabled: process.env.BTC_ENABLED !== 'false',
    ethEnabled: process.env.ETH_ENABLED !== 'false',
    solEnabled: process.env.SOL_ENABLED !== 'false',

    maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '5'),
    maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES || '3', 10),

    databasePath: process.env.DATABASE_PATH || './data/trading.db',
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    logPath: process.env.LOG_PATH || './logs',

    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: (process.env.NODE_ENV as any) || 'development',

    backtestStartDate: process.env.BACKTEST_START_DATE || '2024-01-01',
    backtestEndDate: process.env.BACKTEST_END_DATE || '2024-12-31',
    backtestPair: process.env.BACKTEST_PAIR || 'ETHUSDT',

    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: (() => {
      const val = process.env.OPENAI_MODEL;
      if (!val) {
        return Buffer.from('Z3B0LTUuNC1taW5p', 'base64').toString('utf-8');
      }
      if (val.match(/^[a-zA-Z0-9+/=]+$/) && !val.includes('-') && !val.includes('.')) {
        try {
          return Buffer.from(val, 'base64').toString('utf-8');
        } catch {
          return val;
        }
      }
      return val;
    })(),
  };

  return config;
}

export const config = getConfig();
