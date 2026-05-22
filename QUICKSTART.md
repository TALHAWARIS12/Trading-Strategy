# Quick Start Guide

Get the Crypto Paper Trading Bot running in 5 minutes.

## Prerequisites

- Node.js 18+
- Binance API key (free)
- 100MB+ free disk space

## 1. Setup (2 minutes)

```bash
# Install dependencies
npm install

# Create configuration
cp .env.example .env

# Edit environment (replace YOUR_KEY with your actual Binance API key)
export BINANCE_API_KEY="YOUR_KEY"
export BINANCE_API_SECRET="YOUR_SECRET"
export PAPER_BALANCE="10000"
```

## 2. Build (1 minute)

```bash
npm run build
```

## 3. Run (1 minute)

**Development Mode** (with auto-reload):
```bash
npm run dev
```

**Production Mode**:
```bash
npm start
```

**With PM2** (24/7):
```bash
pm2 start ecosystem.config.js
pm2 logs trading-bot
```

## 4. Monitor (1 minute)

### API Health Check
```bash
curl http://localhost:3000/api/health
```

### View Current Status
```bash
curl http://localhost:3000/api/status | jq
```

### Get Performance Metrics
```bash
curl http://localhost:3000/api/performance | jq
```

### View Open Positions
```bash
curl http://localhost:3000/api/positions | jq
```

### View Trade History
```bash
curl http://localhost:3000/api/trades | jq
```

## 5. Common Tasks

### Validate Strategy Implementation
```bash
npm run validate-strategy
```

### Run Backtest
```bash
npm run backtest
```

### Reset Paper Account
```bash
curl -X POST http://localhost:3000/api/reset-paper-account \
  -H "Content-Type: application/json" \
  -d '{"balance": 10000}'
```

### View Logs
```bash
# Follow all logs
tail -f logs/combined.log

# View trade events only
grep "TRADE_" logs/combined.log

# View errors
tail -f logs/error.log
```

## Configuration

Key parameters in `.env`:

```env
# Binance API
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret

# Trading pairs
TRADING_PAIRS=BTCUSDT,ETHUSDT,SOLUSDT

# Paper account
PAPER_BALANCE=10000
RISK_PERCENT=1
RISK_REWARD_RATIO=2
ATR_MULTIPLIER=1.5

# Server
PORT=3000
LOG_LEVEL=info
```

## Strategy Overview

The bot trades ETH using:
- **5m candles** for entry/exit
- **15m EMA** filter for trend (EMA50 > EMA200)
- **15m ATR** filter for volatility
- **Breakout** of first 1m range
- **Dynamic stops** based on ATR
- **2 take profit targets**: TP1 (1R) and TP2 (RR multiple)
- **1 trade max per 15m range**

## Troubleshooting

### "WebSocket connection failed"
- Check internet connection
- Verify BINANCE_API_KEY is set
- Check firewall allows port 9443

### "No candles received"
- Wait 1-2 minutes for initial data
- Check log file: `tail -f logs/combined.log`
- Verify pair names are correct (ETHUSDT, BTCUSDT, etc.)

### "API responds but no data"
- Ensure WebSocket is connected: `grep -i "connected" logs/combined.log`
- Check for errors: `grep -i "error\|failed" logs/combined.log`

### "High CPU/Memory"
- Check for large position: `curl http://localhost:3000/api/positions`
- Restart bot: `npm run start` (or `pm2 restart trading-bot`)
- Monitor: `pm2 monit`

## Next Steps

1. **Monitor Live Trading**: Watch logs and API endpoints
2. **Adjust Parameters**: Edit `.env` and restart
3. **Deploy to VPS**: See [DEPLOYMENT.md](DEPLOYMENT.md)
4. **Understand Architecture**: Read [ARCHITECTURE.md](ARCHITECTURE.md)
5. **Enable Monitoring**: Setup logs rotation and backups

## API Reference

### Health Endpoints

```
GET /api/health
Response: {"status": "ok", "timestamp": 1234567890}

GET /api/status
Response: {
  "running": true,
  "connectedPairs": ["ETHUSDT"],
  "activePositions": 1,
  "totalBalance": 10000,
  "health": "HEALTHY"
}
```

### Trading Endpoints

```
GET /api/positions
Response: {
  "positions": [{
    "pair": "ETHUSDT",
    "side": "LONG",
    "qty": 1.5,
    "entryPrice": 2000,
    "currentPrice": 2050,
    "pnl": 75,
    "pnlPercent": 3.75
  }],
  "count": 1
}

GET /api/trades
Response: {
  "trades": [...],
  "count": 50
}

GET /api/performance
Response: {
  "totalBalance": 10075,
  "realizedPnL": 150,
  "unrealizedPnL": 75,
  "totalPnL": 225,
  "winRate": 65,
  "totalTrades": 20,
  "maxDrawdown": 5.2,
  "sharpeRatio": 1.45
}
```

### Management Endpoints

```
POST /api/reset-paper-account
Body: {"balance": 10000}
Response: {"message": "Paper account reset", "newBalance": 10000}

POST /api/start-bot
Response: {"message": "Bot start request received", "status": "pending"}

POST /api/stop-bot
Response: {"message": "Bot stop request received", "status": "pending"}
```

### Data Endpoints

```
GET /api/candles?pair=ETHUSDT&interval=5m&limit=100
Response: {
  "pair": "ETHUSDT",
  "interval": "5m",
  "candles": [...],
  "count": 100
}
```

## Performance Expected

- **Signal Latency**: <100ms
- **Trade Execution**: <50ms
- **Database Operations**: <20ms
- **Memory Usage**: 80-150MB
- **CPU Usage**: 5-20%
- **Uptime**: >99.9%

## Safety Checks

✅ Paper trading (no real money)  
✅ Position size validated  
✅ Risk limits enforced  
✅ Stop loss mandatory  
✅ Take profits set automatically  
✅ State persisted to database  
✅ Automatic recovery on crash  
✅ Health monitoring enabled  

## Tips for Success

1. **Start Small**: Use PAPER_BALANCE=1000 first
2. **Monitor Logs**: Follow real-time events
3. **Test Strategy**: Run backtest first
4. **Adjust Gradually**: Change one parameter at a time
5. **Keep Records**: Analyze performance regularly
6. **Restart Regularly**: Clear memory every 24h
7. **Backup Database**: Weekly backups of `data/trading.db`
8. **Update Code**: Check for updates regularly

## Support

For help:
1. Check `logs/combined.log` for errors
2. Verify API keys in `.env`
3. Test with `curl` commands above
4. Review [ARCHITECTURE.md](ARCHITECTURE.md)
5. Check [DEPLOYMENT.md](DEPLOYMENT.md)

---

**Happy Trading!** 🚀

Remember: This is paper trading for learning. Always test thoroughly before deploying.
