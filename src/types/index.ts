// Core trading types
export interface Candle {
  pair: string;
  interval: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface PartialCandle {
  pair: string;
  interval: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isComplete: boolean;
}

export interface Trade {
  id: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  entryQty: number;
  entryTime: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  status: 'OPEN' | 'TP1_PARTIAL_CLOSE' | 'CLOSED';
  exitPrice?: number;
  exitTime?: number;
  pnl?: number;
  pnlPercent?: number;
  exitReason?: string;
}

export interface Position {
  id?: string;
  pair: string;
  side: 'LONG' | 'SHORT' | 'NONE';
  qty: number;
  entryPrice: number;
  entryTime: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  isClosed: boolean;
}

export interface Signal {
  pair: string;
  type: 'ENTRY_LONG' | 'ENTRY_SHORT' | 'EXIT_TP1' | 'EXIT_TP2' | 'EXIT_SL';
  price: number;
  timestamp: number;
  confidence: number;
  reason: string;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  relatedCandles: {
    interval: string;
    timestamp: number;
    candle: Candle;
  }[];
}

export interface PortfolioMetrics {
  totalBalance: number;
  availableBalance: number;
  usedBalance: number;
  unrealizedPnL: number;
  realizedPnL: number;
  totalPnL: number;
  totalPnLPercent: number;
  winRate: number;
  totalTrades: number;
  closedTrades: number;
  openPositions: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

export interface StrategyState {
  pair: string;
  interval: string;
  rangeHigh: number;
  rangeLow: number;
  rangeSize: number;
  rangeTimestamp: number;
  tradeTaken: boolean;
  lastSignal?: Signal;
  lastCandleTimestamp: number;
}

export interface OrderBook {
  pair: string;
  bids: [number, number][]; // [price, qty]
  asks: [number, number][];
  timestamp: number;
}

export interface MarketPrice {
  pair: string;
  price: number;
  timestamp: number;
}

export interface WebSocketMessage {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface BotStatus {
  running: boolean;
  connectedPairs: string[];
  activePositions: number;
  totalBalance: number;
  lastUpdateTime: number;
  uptime: number;
  health: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
}

export interface IndicatorValues {
  ema50?: number;
  ema200?: number;
  atr?: number;
  atrSma?: number;
  bb20?: {
    upper: number;
    middle: number;
    lower: number;
  };
  rsi?: number;
  macd?: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  };
}

export interface CandleBuffer {
  [key: string]: Candle[];
}

export interface StrategyConfig {
  pair: string;
  riskPercent: number;
  riskRewardRatio: number;
  atrMultiplier: number;
  ema50Period: number;
  ema200Period: number;
  atrPeriod: number;
  atrSmaPeriod: number;
  maxConcurrentTrades: number;
  maxDailyLoss: number;
}

export interface TradeLog {
  id: string;
  timestamp: number;
  pair: string;
  side: 'LONG' | 'SHORT';
  type: 'ENTRY' | 'EXIT';
  price: number;
  quantity: number;
  reason: string;
  pnl?: number;
}
