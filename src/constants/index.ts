// Technical Analysis Constants
export const INDICATORS = {
  EMA_50_PERIOD: 50,
  EMA_200_PERIOD: 200,
  ATR_PERIOD: 14,
  ATR_SMA_PERIOD: 20,
  RSI_PERIOD: 14,
  RSI_OVERBOUGHT: 70,
  RSI_OVERSOLD: 30,
  BB_PERIOD: 20,
  BB_STDDEV: 2,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
};

// Candle intervals in milliseconds
export const INTERVALS_MS = {
  '1m': 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

// Order types
export const ORDER_TYPES = {
  MARKET: 'MARKET',
  LIMIT: 'LIMIT',
  STOP: 'STOP',
};

// Order sides
export const ORDER_SIDES = {
  BUY: 'BUY',
  SELL: 'SELL',
};

// Trade statuses
export const TRADE_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
};

// Position types
export const POSITION_TYPES = {
  LONG: 'LONG',
  SHORT: 'SHORT',
  NONE: 'NONE',
};

// Signal types
export const SIGNAL_TYPES = {
  ENTRY_LONG: 'ENTRY_LONG',
  ENTRY_SHORT: 'ENTRY_SHORT',
  EXIT_TP1: 'EXIT_TP1',
  EXIT_TP2: 'EXIT_TP2',
  EXIT_SL: 'EXIT_SL',
  EXIT_TIME: 'EXIT_TIME',
};

// Health check constants
export const HEALTH_CHECK = {
  INTERVAL: 30 * 1000, // 30 seconds
  TIMEOUT: 10 * 1000, // 10 seconds
  MAX_RETRIES: 3,
};

// WebSocket constants
export const WS = {
  RECONNECT_DELAY_MS: 1000,
  MAX_RECONNECT_DELAY_MS: 30 * 1000,
  HEARTBEAT_INTERVAL_MS: 30 * 1000,
  MESSAGE_TIMEOUT_MS: 5000,
  BACKOFF_MULTIPLIER: 1.5,
};

// Precision constants
export const PRECISION = {
  PRICE: 8,
  QUANTITY: 8,
  PERCENTAGE: 2,
};

// Risk management
export const RISK = {
  MIN_RISK_PERCENT: 0.1,
  MAX_RISK_PERCENT: 5,
  MIN_RR_RATIO: 1,
  MAX_RR_RATIO: 10,
  MAX_DAILY_DRAWDOWN_PERCENT: 5,
};

// Binance specific
export const BINANCE = {
  SANDBOX_URL: 'https://testnet.binance.vision',
  PRODUCTION_URL: 'https://api.binance.com',
  WS_URL: 'wss://stream.binance.com:9443',
  WS_SANDBOX_URL: 'wss://stream.testnet.binance.vision:9443',
  MIN_NOTIONAL: 10, // Minimum order value in USDT
};

// Database queries will use these table names
export const DB_TABLES = {
  TRADES: 'trades',
  CANDLES: 'candles',
  SIGNALS: 'signals',
  POSITIONS: 'positions',
  PORTFOLIO_HISTORY: 'portfolio_history',
  LOGS: 'logs',
  STRATEGY_STATE: 'strategy_state',
};

// Cache TTL in milliseconds
export const CACHE_TTL = {
  CANDLES: 1000,
  PRICES: 500,
  INDICATORS: 1000,
};

export const VALID_INTERVALS = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];

export const VALID_TRADING_PAIRS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'ADAUSDT',
  'XRPUSDT',
  'DOGEUSDT',
];
