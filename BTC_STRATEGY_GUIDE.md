# BTC Micro Range Sweep Strategy Integration Guide

This guide explains how to use the BTC strategy (ported from your Pine Script) alongside or instead of the existing ETH strategy.

## Strategy Overview

The BTC Micro Range Sweep strategy implements your Pine Script logic:

```
Features:
├─ Detects first 3m candle of each 15m block
├─ Captures range from that candle (high/low)
├─ Waits for breakout
├─ Long: Price > rangeHigh
├─ Short: Price < rangeLow
├─ Position size: 1% risk
├─ Stop loss: At range boundary
└─ Take profit: 2:1 risk/reward ratio
```

## Differences from Original Pine Script

✅ **Ported exactly as written** (no trend filters, no volatility filters)
✅ **Uses 3m candles** instead of 1m (for BTC or other pairs)
✅ **Stops at range boundaries** (no ±10% offset like ETH strategy)
✅ **Simple 1% risk positioning**
✅ **2:1 take profit ratio** with intermediate TP at 1R

## Using the Strategy

### Option 1: Run BTC Strategy Only

Create a new configuration file for BTC trading:

```typescript
// src/config/btc-config.ts
import { config } from '@/config';

export const btcConfig = {
  ...config,
  tradingPairs: ['BTCUSDT'],  // Only BTC
  cangleIntervals: ['3m', '15m'],  // 3m + 15m
};
```

Then in `app.ts`, switch to BTCStrategy:

```typescript
import { BTCStrategy } from '@/strategies/btc-strategy';

// Replace ETHStrategy with BTCStrategy
const strategy = new BTCStrategy({
  pair: 'BTCUSDT',
  riskPercent: config.riskPercent,  // 1% from .env
  riskRewardRatio: 2.0,  // Fixed 2:1
});
```

### Option 2: Run Both Strategies (ETH + BTC)

Keep both strategies running on different pairs:

```typescript
// In app.ts - run multiple strategies
const ethStrategy = new ETHStrategy({...}, executionEngine);
const btcStrategy = new BTCStrategy({...});

// Process different pairs with different strategies
const signals = pair === 'ETHUSDT' 
  ? await ethStrategy.processCandle(...)
  : await btcStrategy.processCandle(...);
```

### Option 3: Switch Based on Market Conditions

Run different strategies based on volatility or time:

```typescript
const selectStrategy = (pair: string, volatility: number) => {
  if (pair === 'BTCUSDT' && volatility > 2) {
    return 'BTC_MICRO_RANGE';  // High vol → BTC range strategy
  }
  return 'ETH_DEFAULT';  // ETH trend + volatility filtered
};
```

## Configuration in .env

Add or modify these settings for BTC:

```env
# Original ETH settings
TRADING_PAIRS=ETHUSDT

# To use BTC instead:
TRADING_PAIRS=BTCUSDT

# To use both:
TRADING_PAIRS=ETHUSDT,BTCUSDT

# Risk settings (same for both)
PAPER_BALANCE=10000
RISK_PERCENT=1.0          # 1% per trade (required)
RISK_REWARD_RATIO=2.0     # 2:1 (BTC strategy fixed at 2)
```

## Candle Intervals

The BTC strategy uses **3-minute candles** instead of 1-minute. The bot already supports multiple intervals via the candle builder:

```typescript
// Supported intervals (in src/constants/index.ts)
const INTERVALS_MS = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
};

// The candle builder automatically creates these if subscribed
```

Update `.env` to include 3m candles:

```env
# In your bot configuration
CANDLE_INTERVALS=3m,15m  # For BTC micro range strategy
# or
CANDLE_INTERVALS=1m,5m,15m  # For ETH existing strategy
```

## API Endpoints for BTC Strategy

Once running, monitor the BTC strategy via API:

```bash
# View open BTC positions
curl http://localhost:3000/api/positions | jq '.positions[] | select(.pair=="BTCUSDT")'

# View BTC trade history
curl http://localhost:3000/api/trades | jq '.trades[] | select(.pair=="BTCUSDT")'

# View BTC-specific performance
curl http://localhost:3000/api/performance | jq
```

## Strategy Parameters

The BTC strategy has minimal parameters:

```typescript
interface StrategyConfig {
  pair: string;              // "BTCUSDT"
  riskPercent: number;       // 1.0 (from .env)
  riskRewardRatio: number;   // 2.0 (fixed)
  atrMultiplier?: number;    // Not used in BTC strategy
}
```

## Testing the Strategy

### 1. Validate Strategy Logic

```bash
npm run validate-strategy
```

This verifies the strategy initializes correctly.

### 2. Backtest on Historical Data

The BTC strategy can be backtested using the backtest engine:

```bash
npm run backtest
```

(Will need to add BTC backtest mode)

### 3. Monitor Live Execution

```bash
# Start bot with BTC strategy
npm run dev

# In another terminal, watch logs
tail -f logs/combined.log | grep "BTCStrategy"

# Watch trades in real-time
curl http://localhost:3000/api/trades | jq
```

## Key Differences from ETH Strategy

| Feature | ETH Strategy | BTC Strategy |
|---------|--------------|--------------|
| Trend Filter | EMA50 > EMA200 on 15m | ❌ None |
| Volatility Filter | ATR > ATR_SMA on 15m | ❌ None |
| Candle Period | 1 minute | 3 minutes |
| Range Detection | First 1m candle | First 3m candle |
| Entry Logic | Breakout ±10% range | Exact range breakout |
| Complexity | Advanced (7 rules) | Simple (2 rules) |
| Win Rate | Likely 50-65% | Likely 40-60% (depends on pair) |

## Backtesting Performance Expected

Since this is a simpler, more straightforward strategy:

- **Win Rate**: 40-60% (fewer filters = more noise)
- **Profit Factor**: 1.0-1.5 (breakout strategies are streaky)
- **Max Drawdown**: 8-15% (larger swings possible)
- **Sharpe Ratio**: 0.5-1.0 (less consistent)

**Note**: The ETH strategy with trend+volatility filters typically has better metrics. This BTC strategy is pure range breakout.

## Troubleshooting

### No signals generated
- Check TRADING_PAIRS includes BTCUSDT
- Verify 3m candles are being received: `grep "3m" logs/combined.log`
- Check if WebSocket is connected: `curl http://localhost:3000/api/status`

### Wrong candle interval
- BTC strategy expects `candles3m` array
- If you only have 1m candles, it won't work correctly
- Verify interval in candle subscription: `grep "subscribe.*3m" logs/combined.log`

### Position sizes seem wrong
- Check PAPER_BALANCE in .env
- Verify RISK_PERCENT is set to 1.0
- Position size = (balance × 1%) / (entry - stopLoss)

## Database Schema for BTC

The same database schema supports both strategies:

```sql
-- BTC trades stored in same 'trades' table
SELECT * FROM trades WHERE pair = 'BTCUSDT';

-- BTC candles stored in same 'candles' table
SELECT * FROM candles WHERE pair = 'BTCUSDT' AND interval = '3m';

-- BTC signals in same 'signals' table
SELECT * FROM signals WHERE pair = 'BTCUSDT';
```

## Next Steps

1. **Choose strategy**:
   - BTC only: Update TRADING_PAIRS=BTCUSDT
   - ETH only: Keep current TRADING_PAIRS=ETHUSDT
   - Both: TRADING_PAIRS=ETHUSDT,BTCUSDT

2. **Update candle intervals**:
   - For BTC: CANDLE_INTERVALS=3m,15m
   - For ETH: CANDLE_INTERVALS=1m,5m,15m
   - For both: CANDLE_INTERVALS=1m,3m,5m,15m

3. **Update strategy selection in app.ts**

4. **Test locally**: `npm run dev`

5. **Monitor**: Follow logs and API endpoints

6. **Deploy**: Use PM2 or Docker with new config

## Extending Further

### Add More Strategies

```typescript
// src/strategies/index.ts
export { ETHStrategy } from './eth-strategy';
export { BTCStrategy } from './btc-strategy';
export { SolStrategy } from './sol-strategy';  // Can add more
```

### Dynamic Strategy Selection

```typescript
// Choose strategy based on pair
function createStrategy(pair: string): TradingStrategy {
  switch(pair) {
    case 'BTCUSDT': return new BTCStrategy(...);
    case 'ETHUSDT': return new ETHStrategy(...);
    default: return new DefaultStrategy(...);
  }
}
```

### Hybrid Approach

```typescript
// Run BTC strategy during high volatility
// Run ETH strategy during normal conditions
const useHighVolStrategy = atr > atr_sma;
const strategy = useHighVolStrategy ? btcStrategy : ethStrategy;
```

---

**Questions?**

- Check [ARCHITECTURE.md](ARCHITECTURE.md) for system design
- See [QUICKSTART.md](QUICKSTART.md) for basic setup
- Review [README.md](README.md) for API details

**Happy trading!** 🚀
