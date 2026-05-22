# Crypto Paper Trading Bot

A production-grade, real-time cryptocurrency paper trading system using Node.js, TypeScript, and Binance WebSockets.

## Features

✅ **Real-Time Market Data** - Live streaming from Binance WebSocket  
✅ **Multi-Timeframe Analysis** - 1m, 5m, 15m candle synchronization  
✅ **Advanced Strategy** - ETH trading with EMA, ATR, and volatility filters  
✅ **Risk Management** - Dynamic position sizing and stop loss management  
✅ **Paper Trading** - Accurate simulation without real money  
✅ **State Persistence** - SQLite database for recovery  
✅ **REST API** - Complete endpoints for control and monitoring  
✅ **Health Monitoring** - Automatic connection recovery  
✅ **Production Ready** - PM2 and Docker deployment support  

## Project Structure

```
src/
├── app.ts                 # Main entry point
├── config/                # Configuration management
├── types/                 # TypeScript type definitions
├── constants/             # Constants and magic numbers
├── logging/               # Winston logging
├── database/              # SQLite3 database layer
├── exchange/              # Exchange API integration
├── websocket/             # Binance WebSocket manager
├── market/                # Market data engine
├── candles/               # Candle building & synchronization
├── indicators/            # Technical indicators (EMA, ATR, RSI, BB, MACD)
├── strategies/            # ETH trading strategy
├── execution/             # Paper trading engine
├── risk/                  # Risk management & position sizing
├── positions/             # Position tracking
├── portfolio/             # Portfolio metrics & equity tracking
├── backtesting/           # Historical backtesting engine
├── api/                   # Express REST API server
├── websocket-server/      # WebSocket server for dashboard
├── validation/            # Runtime validation (Zod)
├── utils/                 # Utility functions
├── recovery/              # State recovery on crash
├── monitoring/            # Health monitoring
├── workers/               # Background workers
└── scripts/               # Utility scripts
```

## Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Binance API key and secret
- 2GB+ RAM
- 500MB+ disk space

### Setup

1. **Clone and install**:
   ```bash
   git clone <repo-url>
   cd crypto-trading-bot
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your settings:
   ```env
   BINANCE_API_KEY=your_api_key
   BINANCE_API_SECRET=your_api_secret
   PAPER_BALANCE=10000
   RISK_PERCENT=1
   TRADING_PAIRS=BTCUSDT,ETHUSDT,SOLUSDT
   ```

3. **Build**:
   ```bash
   npm run build
   ```

4. **Run**:
   ```bash
   npm run dev      # Development
   npm start        # Production
   ```

## API Endpoints

### Health & Status
- `GET /api/health` - Health check
- `GET /api/status` - Bot status and metrics

### Trading
- `GET /api/positions` - Current open positions
- `GET /api/trades` - Trade history
- `POST /api/reset-paper-account` - Reset account

### Data
- `GET /api/candles?pair=ETHUSDT&interval=5m&limit=100` - Get candles
- `GET /api/signals` - Trading signals
- `GET /api/performance` - Performance metrics

### Control
- `POST /api/start-bot` - Start bot
- `POST /api/stop-bot` - Stop bot

## Strategy Details

### ETH Strategy

**Execution Timeframe**: 5-minute candles  
**Analysis Timeframes**: 1m, 5m, 15m

#### Rules

1. **Trend Filter** (15m EMA)
   - Bull: EMA50 > EMA200
   - Bear: EMA50 < EMA200

2. **Volatility Filter** (15m ATR)
   - Trade only when: ATR > ATR_SMA(20)

3. **Range Detection** (15m candle open)
   - Capture first 1m candle high/low
   - Calculate range size

4. **Breakout Entry**
   - Long: Close > RangeHigh + RangeSize × 0.1
   - Short: Close < RangeLow - RangeSize × 0.1

5. **Stop Loss** (Dynamic ATR-based)
   - Long: RangeLow - ATR × 1.5
   - Short: RangeHigh + ATR × 1.5

6. **Take Profits**
   - TP1: 1R profit (partial close)
   - TP2: RiskReward multiple (full close)

7. **Trade Limitation**
   - Maximum 1 trade per 15m range

## Configuration

### Risk Parameters
```env
RISK_PERCENT=1              # Risk per trade (0.1-5%)
RISK_REWARD_RATIO=2         # TP2 / SL ratio
ATR_MULTIPLIER=1.5          # SL distance multiplier
MAX_CONCURRENT_TRADES=3     # Max open trades
MAX_DAILY_LOSS_PERCENT=5    # Daily loss limit
```

### Market Parameters
```env
TRADING_PAIRS=BTCUSDT,ETHUSDT,SOLUSDT
INTERVALS=1m,5m,15m
PAPER_BALANCE=10000
```

## Database

SQLite database stores:
- Trades (entries, exits, PnL)
- Candles (OHLCV data)
- Signals (entry/exit triggers)
- Positions (active trades)
- Portfolio history (equity curve)
- Strategy state (range data)

Located at `./data/trading.db`

## Logging

Logs are saved to `./logs/`:
- `combined.log` - All events
- `error.log` - Errors only
- `trades.log` - Trade events
- `exceptions.log` - Uncaught exceptions

Configure log level in `.env`:
```env
LOG_LEVEL=info  # debug, info, warn, error
```

## WebSocket Reliability

The bot handles:
- Automatic reconnection with exponential backoff
- Heartbeat monitoring
- Stale socket detection
- Message queue handling
- Duplicate candle prevention
- Out-of-order candle detection

Reconnection delays: 1s → 30s (1.5x backoff)

## Deployment

### VPS Deployment (Ubuntu)

1. **Install dependencies**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs npm
   sudo npm install -g pm2
   ```

2. **Deploy**:
   ```bash
   git clone <repo-url>
   cd crypto-trading-bot
   npm install
   npm run build
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

3. **Monitor**:
   ```bash
   pm2 logs trading-bot
   pm2 monit
   pm2 describe trading-bot
   ```

### Docker Deployment

1. **Build**:
   ```bash
   docker build -t trading-bot .
   ```

2. **Run**:
   ```bash
   docker run -d \
     --name trading-bot \
     -p 3000:3000 \
     -e BINANCE_API_KEY=xxx \
     -e BINANCE_API_SECRET=xxx \
     -v $(pwd)/data:/app/data \
     -v $(pwd)/logs:/app/logs \
     trading-bot
   ```

3. **Docker Compose**:
   ```bash
   docker-compose up -d
   ```

## Monitoring & Debugging

### Check Status
```bash
curl http://localhost:3000/api/status
```

### View Logs
```bash
tail -f logs/combined.log
```

### Reset Account
```bash
curl -X POST http://localhost:3000/api/reset-paper-account
```

### Get Performance
```bash
curl http://localhost:3000/api/performance
```

## Testing

```bash
# Validate strategy implementation
npm run validate-strategy

# Run all tests
npm run test

# Watch mode
npm run test:watch

# TypeScript check
npm run typecheck
```

## Performance Optimization

- Candle buffers limited to 500 per symbol/interval
- Indicator calculations optimized with memoization
- Non-blocking event-driven architecture
- Minimal memory footprint (~100MB idle)
- Low-latency signal generation (<100ms)

## Security

- Environment variables for credentials
- Input validation with Zod
- Error boundaries and graceful degradation
- No logging of sensitive data
- Database encryption recommended for production

## Troubleshooting

### WebSocket Connection Failed
- Check internet connection
- Verify Binance API key/secret
- Check firewall for port 9443 (WebSocket)

### No Candles Received
- Verify pair names (uppercase, e.g., ETHUSDT)
- Check Binance API key has read permissions
- Monitor logs for WebSocket errors

### Trades Not Executing
- Check paper balance
- Verify minimum notional (10 USDT)
- Check strategy state for trend/volatility filters

### Database Lock
- Stop bot and restart
- Check permissions on ./data directory
- Ensure no multiple instances running

### Memory Leak
- Monitor with `pm2 monit`
- Check for large candle buffers
- Restart bot if needed

## Performance Metrics

Expected performance:
- Signal generation: <100ms
- Candle processing: <50ms
- Database operations: <20ms
- Memory usage: 80-150MB
- CPU usage: <20%
- Uptime: >99.9%

## Maintenance

### Daily
- Monitor logs for errors
- Check equity curve
- Verify positions are updating

### Weekly
- Review performance metrics
- Check database size
- Test recovery procedures

### Monthly
- Archive old logs
- Backup database
- Update dependencies: `npm audit fix`

## Limitations

- Paper trading only (no real money)
- Single strategy (ETH only)
- Binance only (no other exchanges)
- Single account per instance
- No leverage trading

## Future Enhancements

- [ ] Multi-strategy support
- [ ] Portfolio optimization
- [ ] Machine learning indicators
- [ ] Live trading support
- [ ] Multiple exchange support
- [ ] Advanced dashboard UI
- [ ] Telegram notifications
- [ ] Email alerts
- [ ] Performance analytics
- [ ] Backtesting engine

## Support & Contact

For issues and support:
1. Check logs in `./logs/`
2. Review API responses
3. Verify configuration
4. Test with smaller positions

## License

MIT

## Disclaimer

This is a paper trading bot for educational purposes. Use at your own risk. Always test thoroughly before deploying. Past performance does not guarantee future results.

---

**Version**: 1.0.0  
**Last Updated**: 2024
