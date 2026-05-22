import { ExecutionEngine } from '@/execution';
import { ETHStrategy } from '@/strategies';
import { Candle } from '@/types';

describe('ExecutionEngine', () => {
  let executionEngine: ExecutionEngine;

  beforeEach(() => {
    executionEngine = new ExecutionEngine(10000);
  });

  it('should initialize with correct balance', () => {
    expect(executionEngine.getCurrentBalance()).toBe(10000);
  });

  it('should open a long trade', () => {
    const trade = executionEngine.openLongTrade(
      'ETHUSDT',
      2000,
      1,
      1950,
      2050,
      2100
    );

    expect(trade).not.toBeNull();
    expect(trade!.side).toBe('LONG');
    expect(trade!.status).toBe('OPEN');
  });

  it('should open a short trade', () => {
    const trade = executionEngine.openShortTrade(
      'ETHUSDT',
      2000,
      1,
      2050,
      1950,
      1900
    );

    expect(trade).not.toBeNull();
    expect(trade!.side).toBe('SHORT');
    expect(trade!.status).toBe('OPEN');
  });

  it('should calculate unrealized PnL', () => {
    const prices = new Map([['ETHUSDT', 2100]]);
    executionEngine.openLongTrade('ETHUSDT', 2000, 1, 1950, 2050, 2100);

    const pnl = executionEngine.getUnrealizedPnL(prices);
    expect(pnl).toBeGreaterThan(0);
  });

  it('should close trade at take profit', () => {
    const trade = executionEngine.openLongTrade(
      'ETHUSDT',
      2000,
      1,
      1950,
      2050,
      2100
    );

    if (trade) {
      const closedTrade = executionEngine.closeTradeAtTP1(trade.id, 2050);
      expect(closedTrade!.status).toBe('TP1_PARTIAL_CLOSE');
      expect(closedTrade!.pnl).toBeGreaterThan(0);
    }
  });

  it('should close trade at stop loss', () => {
    const trade = executionEngine.openLongTrade(
      'ETHUSDT',
      2000,
      1,
      1950,
      2050,
      2100
    );

    if (trade) {
      const closedTrade = executionEngine.closeTradeAtExit(trade.id, 1900, 'SL_HIT');
      expect(closedTrade!.status).toBe('CLOSED');
      expect(closedTrade!.pnl).toBeLessThan(0);
    }
  });

  it('should calculate performance metrics', () => {
    executionEngine.openLongTrade('ETHUSDT', 2000, 1, 1950, 2050, 2100);
    executionEngine.openShortTrade('BTCUSDT', 2000, 1, 2050, 1950, 1900);

    const metrics = executionEngine.getPerformanceMetrics();
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.openTrades).toBe(2);
    expect(metrics.closedTrades).toBe(0);
  });

  it('should reset trading engine', () => {
    executionEngine.openLongTrade('ETHUSDT', 2000, 1, 1950, 2050, 2100);
    executionEngine.reset(5000);

    expect(executionEngine.getCurrentBalance()).toBe(5000);
    expect(executionEngine.getOpenTrades().length).toBe(0);
  });
});

describe('ETHStrategy', () => {
  let executionEngine: ExecutionEngine;
  let strategy: ETHStrategy;

  beforeEach(() => {
    executionEngine = new ExecutionEngine(10000);
    strategy = new ETHStrategy(
      {
        pair: 'ETHUSDT',
        riskPercent: 1,
        riskRewardRatio: 2,
        atrMultiplier: 1.5,
      },
      executionEngine
    );
  });

  it('should initialize strategy state', () => {
    strategy.initializeState('ETHUSDT', '15m');
    const state = strategy.getState('ETHUSDT', '15m');

    expect(state).not.toBeNull();
    expect(state!.pair).toBe('ETHUSDT');
    expect(state!.interval).toBe('15m');
    expect(state!.tradeTaken).toBe(false);
  });

  it('should reset strategy', () => {
    strategy.initializeState('ETHUSDT', '15m');
    strategy.reset();

    const state = strategy.getState('ETHUSDT', '15m');
    expect(state).toBeNull();
  });

  it('should process candles without error', async () => {
    const candles1m: Candle[] = [
      {
        pair: 'ETHUSDT',
        interval: '1m',
        timestamp: Date.now(),
        open: 2000,
        high: 2010,
        low: 1990,
        close: 2005,
        volume: 100,
        isClosed: true,
      },
    ];

    const candles5m: Candle[] = [
      {
        pair: 'ETHUSDT',
        interval: '5m',
        timestamp: Date.now(),
        open: 2000,
        high: 2010,
        low: 1990,
        close: 2005,
        volume: 500,
        isClosed: true,
      },
    ];

    const candles15m: Candle[] = [
      {
        pair: 'ETHUSDT',
        interval: '15m',
        timestamp: Date.now(),
        open: 2000,
        high: 2010,
        low: 1990,
        close: 2005,
        volume: 1500,
        isClosed: true,
      },
    ];

    const signals = await strategy.processCandle(
      candles1m,
      candles5m,
      candles15m,
      2005
    );

    expect(signals).toBeDefined();
    expect(Array.isArray(signals)).toBe(true);
  });
});
