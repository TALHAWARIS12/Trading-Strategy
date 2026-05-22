# Architecture Documentation

Complete architecture overview of the Crypto Paper Trading Bot.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Binance WebSocket Stream                  │
│                    (Real-Time Market Data)                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      WebSocket Manager                           │
│  - Connection handling                                           │
│  - Reconnection logic with exponential backoff                   │
│  - Message routing                                               │
└──────────────────────────┬──────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐    ┌──────────────┐    ┌──────────────┐
   │ Kline   │    │ Trade Data   │    │ Order Book   │
   │ Events  │    │              │    │              │
   └────┬────┘    └──────┬───────┘    └──────┬───────┘
        │                │                    │
        └────────────────┼────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │     Candle Builder             │
        │  - Candle synchronization      │
        │  - OHLCV assembly              │
        │  - Duplicate prevention        │
        │  - Out-of-order detection      │
        └────────┬───────────────────────┘
                 │
                 ▼
    ┌────────────────────────────────┐
    │    Candle Buffers              │
    │  - 1m candles (100s)           │
    │  - 5m candles (100s)           │
    │  - 15m candles (100s)          │
    └────────┬───────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │       Indicator Calculator             │
    │  - EMA 50/200                          │
    │  - ATR & ATR SMA                       │
    │  - RSI, MACD, Bollinger Bands          │
    │  - Trend filters                       │
    └────────┬───────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │        Strategy Engine                 │
    │  - ETH trading strategy                │
    │  - Signal generation                   │
    │  - Trade execution logic               │
    │  - Synchronization checks              │
    └────────┬───────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │      Risk Manager                      │
    │  - Position sizing                     │
    │  - Stop loss calculation               │
    │  - Take profit calculation             │
    │  - Risk/reward validation              │
    └────────┬───────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │     Execution Engine                   │
    │  - Paper trade execution               │
    │  - Position tracking                   │
    │  - PnL calculation                     │
    │  - Trade lifecycle management          │
    └────────┬───────────────────────────────┘
             │
    ┌────────┴────────────┬─────────────────┐
    ▼                     ▼                 ▼
┌──────────┐    ┌─────────────────┐   ┌───────────┐
│ Portfolio │    │   Database      │   │  Logging  │
│ Metrics   │    │  - Trades       │   │  - Events │
│ - Equity  │    │  - Candles      │   │  - Errors │
│ - PnL     │    │  - Signals      │   │  - Trades │
│ - Win %   │    │  - State        │   │  - Status │
└─────┬─────┘    └────┬────────────┘   └───────────┘
      │               │
      └───────────────┼──────────────────┐
                      │                  │
                      ▼                  ▼
              ┌──────────────────────────────────┐
              │      API Server                  │
              │  - REST endpoints                │
              │  - Status queries                │
              │  - Control commands              │
              └──────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────────┐
              │   Client / Dashboard     │
              │  - React Frontend        │
              │  - Real-time updates     │
              │  - Performance charts    │
              └──────────────────────────┘
```

## Core Modules

### 1. WebSocket Manager (`websocket/`)
**Responsibility**: Maintain Binance WebSocket connections

**Features**:
- Automatic reconnection with exponential backoff (1s → 30s)
- Heartbeat monitoring
- Message queuing during disconnects
- Event emission for different message types
- Subscription management

**Key Classes**:
- `BinanceWebSocket` - Single connection handler
- `WebSocketManager` - Multiple connection manager

**Data Flow**:
```
WebSocket Stream → Parse JSON → Event Emitter → Candle Builder
```

### 2. Candle Builder (`candles/`)
**Responsibility**: Build and synchronize OHLCV candles

**Features**:
- Processes Kline data from WebSocket
- Detects closed vs partial candles
- Maintains rolling buffers (500 candles max per symbol/interval)
- Detects missing candles
- Detects out-of-order candles
- Synchronizes across intervals

**Key Classes**:
- `CandleBuilder` - Kline processing and candle assembly

**Data Flow**:
```
Raw Kline → Validation → Partial/Closed → Buffer → Callbacks
```

### 3. Indicator Calculator (`indicators/`)
**Responsibility**: Calculate technical indicators

**Indicators Supported**:
- EMA (Exponential Moving Average)
- SMA (Simple Moving Average)
- ATR (Average True Range)
- RSI (Relative Strength Index)
- Bollinger Bands
- MACD (Moving Average Convergence Divergence)

**Optimization**:
- Calculated only when needed
- Reuse previous values where possible
- Cache recent calculations

**Example**:
```typescript
const ema50 = IndicatorCalculator.calculateEMA(candles15m, 50);
const atr = IndicatorCalculator.calculateATR(candles15m, 14);
```

### 4. Strategy Engine (`strategies/`)
**Responsibility**: Implement trading logic

**ETH Strategy Logic**:
1. **Trend Filter** (15m): EMA50 > EMA200 (Bull) or < (Bear)
2. **Volatility Filter** (15m): ATR > ATR_SMA
3. **Range Detection** (15m open): First 1m candle high/low
4. **Breakout Entry**: Price breaks range ±10%
5. **Dynamic Stops**: ATR-based stop loss
6. **Profit Targets**: TP1 (1R) and TP2 (RR multiple)
7. **Trade Limit**: Max 1 per 15m range (with execution lock)

**Synchronization Features**:
- Waits for all intervals to align
- Prevents lookahead bias
- Deduplicates signals
- Locks execution during candle formation

**Key Classes**:
- `ETHStrategy` - Concrete strategy implementation

### 5. Risk Manager (`risk/`)
**Responsibility**: Calculate and validate risk parameters

**Features**:
- Position sizing based on risk amount
- Stop loss and take profit calculation
- Risk/reward ratio validation
- Minimum notional value checking
- Max position size calculation

**Formula**:
```
Position Size = (Equity × Risk%) / (Entry - SL)
TP1 = Entry + ATR × Multiplier
TP2 = Entry + ATR × Multiplier × RR_Ratio
```

### 6. Execution Engine (`execution/`)
**Responsibility**: Execute and track paper trades

**Features**:
- Open long/short positions
- Close at take profits (TP1, TP2) or stop loss
- Track unrealized and realized PnL
- Calculate performance metrics
- Maintain trade history

**Trade Lifecycle**:
```
OPEN → TP1_PARTIAL_CLOSE → CLOSED (at TP2 or SL)
```

**Key Classes**:
- `ExecutionEngine` - Trade execution and tracking

### 7. Portfolio (`portfolio/`)
**Responsibility**: Aggregate portfolio metrics

**Metrics**:
- Total balance and equity
- Unrealized vs realized PnL
- Win rate and drawdown
- Sharpe ratio
- Equity curve

**Key Classes**:
- `Portfolio` - Portfolio tracking and analytics

### 8. Database (`database/`)
**Responsibility**: Persist state to SQLite

**Tables**:
- `trades` - Trade history
- `candles` - Historical candles
- `signals` - Generated signals
- `positions` - Active positions
- `portfolio_history` - Equity snapshots
- `strategy_state` - Strategy variables
- `logs` - Event logs

**Features**:
- Automatic table creation
- Index optimization
- Transaction support
- Recovery support

### 9. API Server (`api/`)
**Responsibility**: Provide REST interface

**Endpoints**:
```
GET  /api/health              - Health check
GET  /api/status              - Bot status
GET  /api/positions           - Open positions
GET  /api/trades              - Trade history
GET  /api/performance         - Metrics
GET  /api/candles             - Historical candles
POST /api/start-bot           - Start bot
POST /api/stop-bot            - Stop bot
POST /api/reset-paper-account - Reset account
```

### 10. Health Monitor (`monitoring/`)
**Responsibility**: Monitor system health

**Features**:
- WebSocket connection monitoring
- Health status (HEALTHY, DEGRADED, CRITICAL)
- Uptime tracking
- Periodic health checks

### 11. Recovery Manager (`recovery/`)
**Responsibility**: Recover from crashes

**Features**:
- Load open trades from database on startup
- Verify state integrity
- Detect and fix common issues
- Prevent duplicate trades on recovery

## Data Flow Example

### New 5m Candle Processing

```
1. WebSocket receives kline event
   └─> BinanceWebSocket.handleMessage()

2. Parse kline data
   └─> CandleBuilder.processKline()

3. If candle is closed:
   └─> Validate candle
   └─> Update buffers
   └─> Emit candle closed event

4. Strategy processes new candle
   └─> ETHStrategy.processCandle()
   └─> IndicatorCalculator calculates metrics
   └─> Risk Manager sizes position
   └─> Execution Engine opens trade (if signal)

5. Record state
   └─> Database.insertTrade()
   └─> Database.insertCandle()
   └─> Portfolio.recordEquity()

6. API returns updated state
   └─> GET /api/status returns latest metrics
```

## Synchronization Mechanism

### Candle Alignment
All strategies must process closed candles only:
```
1m:  ├─ 00:00 ├─ 01:00 ├─ 02:00 ├─ 03:00 ├─ 04:00 ├─
5m:  ├────── 00:00 ─────┼────── 05:00 ─────┼────── 10:00
15m: ├──────── 00:00 ────────────┼──────── 15:00 ────────
```

### Strategy Synchronization Rules
1. Wait for all candle intervals to close
2. Verify timestamps align properly
3. Prevent trading on partial candles
4. Use execution locks to prevent duplicates
5. Record related candles with signals

## Error Handling

### Cascading Failures
```
WebSocket Disconnection
  └─> Reconnect with backoff
  └─> Queue messages
  └─> Resume on reconnect

Invalid Candle Data
  └─> Log warning
  └─> Skip processing
  └─> Continue

Strategy Error
  └─> Log error
  └─> Don't execute trade
  └─> Continue monitoring

Database Error
  └─> Log error
  └─> Retry on next interval
  └─> Degrade gracefully
```

### Recovery Strategy
1. On startup: Load trades from database
2. Verify integrity of loaded trades
3. Resume WebSocket connections
4. Continue processing from where left off
5. If state corrupted: Start fresh with timestamp

## Performance Considerations

### Optimization Points
- **Candle Processing**: O(1) buffer updates
- **Indicator Calculation**: Only when needed
- **Database Writes**: Batched where possible
- **Memory Usage**: Rolling buffers prevent bloat
- **CPU Usage**: Event-driven, not polling

### Resource Limits
- Max 500 candles per symbol/interval in memory
- 30-minute max health check interval
- 1GB max memory recommended
- 10Mbps network sufficient

## Security Model

### Data Protection
- API key/secret in environment variables only
- No credentials in logs
- Database encrypted at rest (recommended)
- SSL/TLS for API (with proxy)

### Input Validation
- Zod schema validation for all inputs
- Price and quantity checks
- Timestamp validation
- Pair name validation

### Error Boundaries
- Try-catch on all event handlers
- Graceful degradation on errors
- No unhandled promise rejections
- Signal handlers for clean shutdown

## Testing Strategy

### Unit Tests
- Execution Engine (trade lifecycle)
- Risk Manager (position sizing)
- Indicator Calculator (formula correctness)
- Strategy Logic (signal generation)

### Integration Tests
- Candle Builder → Strategy
- Strategy → Execution Engine
- Execution Engine → Portfolio
- All → Database

### Backtesting
- Replay historical candles
- Deterministic execution
- Performance analysis
- Optimization testing

## Deployment Architecture

### Local Development
```
Node.js → TypeScript (ts-node) → Console Logs → File Logs
```

### Docker Production
```
Docker Registry → Container → SQLite Volume → Logs Volume
                       │
                       └─→ PM2 Monitoring
```

### VPS Production
```
Ubuntu → Node.js 18 → PM2 → Nginx (Reverse Proxy) → SSL/TLS
           │
           └─→ Systemd Auto-start
           └─→ Cron Backups
           └─→ Log Rotation
```

---

**Key Design Principles**:
1. **Separation of Concerns** - Each module has single responsibility
2. **Event-Driven** - Non-blocking, async processing
3. **Resilience** - Automatic recovery from failures
4. **Synchronization** - Prevents lookahead and duplicate execution
5. **Persistence** - All state saved to database
6. **Monitoring** - Health checks and comprehensive logging
