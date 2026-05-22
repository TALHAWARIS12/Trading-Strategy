import { z } from 'zod';
import { Candle, Trade, Signal, StrategyConfig } from '@/types';
import logger from '@/logging';

// Schema for candles
const CandleSchema = z.object({
  pair: z.string().min(1),
  interval: z.string().min(1),
  timestamp: z.number().positive(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative(),
  isClosed: z.boolean(),
});

// Schema for trades
const TradeSchema = z.object({
  id: z.string().min(1),
  pair: z.string().min(1),
  side: z.enum(['LONG', 'SHORT']),
  entryPrice: z.number().positive(),
  entryQty: z.number().positive(),
  entryTime: z.number().positive(),
  stopLoss: z.number(),
  takeProfit1: z.number().positive(),
  takeProfit2: z.number().positive(),
  status: z.enum(['OPEN', 'TP1_PARTIAL_CLOSE', 'CLOSED']),
  exitPrice: z.number().optional(),
  exitTime: z.number().optional(),
  pnl: z.number().optional(),
  pnlPercent: z.number().optional(),
  exitReason: z.string().optional(),
});

// Schema for signals
const SignalSchema = z.object({
  pair: z.string().min(1),
  type: z.enum(['ENTRY_LONG', 'ENTRY_SHORT', 'EXIT_TP1', 'EXIT_TP2', 'EXIT_SL']),
  price: z.number().positive(),
  timestamp: z.number().positive(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  relatedCandles: z.array(z.object({
    interval: z.string(),
    timestamp: z.number(),
    candle: CandleSchema,
  })).default([]),
});

// Schema for strategy config
const StrategyConfigSchema = z.object({
  pair: z.string().min(1),
  riskPercent: z.number().min(0.1).max(5),
  riskRewardRatio: z.number().min(1).max(10),
  atrMultiplier: z.number().min(0.5).max(5),
  ema50Period: z.number().min(10).max(200).optional().default(50),
  ema200Period: z.number().min(100).max(500).optional().default(200),
  atrPeriod: z.number().min(5).max(30).optional().default(14),
  atrSmaPeriod: z.number().min(5).max(50).optional().default(20),
  maxConcurrentTrades: z.number().min(1).max(10).optional().default(3),
  maxDailyLoss: z.number().min(0).optional().default(5),
});

export function validateCandle(data: unknown): Candle | null {
  try {
    return CandleSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`Invalid candle data: ${JSON.stringify(error.errors)}`);
    }
    return null;
  }
}

export function validateTrade(data: unknown): Trade | null {
  try {
    return TradeSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`Invalid trade data: ${JSON.stringify(error.errors)}`);
    }
    return null;
  }
}

export function validateSignal(data: unknown): Signal | null {
  try {
    return SignalSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`Invalid signal data: ${JSON.stringify(error.errors)}`);
    }
    return null;
  }
}

export function validateStrategyConfig(data: unknown): StrategyConfig | null {
  try {
    return StrategyConfigSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`Invalid strategy config: ${JSON.stringify(error.errors)}`);
    }
    return null;
  }
}

export function validatePrice(price: unknown): boolean {
  return typeof price === 'number' && price > 0 && Number.isFinite(price);
}

export function validateQuantity(qty: unknown): boolean {
  return typeof qty === 'number' && qty > 0 && Number.isFinite(qty);
}

export function validateTimestamp(ts: unknown): boolean {
  return typeof ts === 'number' && ts > 0 && ts < Date.now() + 1000 * 60 * 60; // Within 1 hour future
}

export function validatePair(pair: unknown): boolean {
  return typeof pair === 'string' && /^[A-Z0-9]+USDT$/.test(pair);
}

export function validateInterval(interval: unknown): boolean {
  const validIntervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
  return typeof interval === 'string' && validIntervals.includes(interval);
}
