# Deployment Guide

Complete guide for deploying the Crypto Paper Trading Bot to production.

## Table of Contents
- [Local Development](#local-development)
- [Docker Deployment](#docker-deployment)
- [VPS Deployment](#vps-deployment)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Local Development

### Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Build TypeScript
npm run build

# Run development server
npm run dev

# Or run production build
npm run build && npm start
```

### Development Mode

For development with hot reload:
```bash
npm run dev
```

This runs the TypeScript directly via ts-node. Logs will output to console and file.

## Docker Deployment

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+ (for compose deployment)

### Single Container

1. **Build image**:
   ```bash
   docker build -t trading-bot:latest .
   ```

2. **Create .env file**:
   ```bash
   cp .env.example .env
   # Edit with your API credentials
   ```

3. **Run container**:
   ```bash
   docker run -d \
     --name trading-bot \
     --restart unless-stopped \
     -p 3000:3000 \
     --env-file .env \
     -v $(pwd)/data:/app/data \
     -v $(pwd)/logs:/app/logs \
     trading-bot:latest
   ```

4. **Monitor**:
   ```bash
   docker logs -f trading-bot
   docker stats trading-bot
   ```

5. **Stop**:
   ```bash
   docker stop trading-bot
   docker rm trading-bot
   ```

### Docker Compose

1. **Prepare environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

2. **Start services**:
   ```bash
   docker-compose up -d
   ```

3. **Monitor logs**:
   ```bash
   docker-compose logs -f trading-bot
   ```

4. **Stop services**:
   ```bash
   docker-compose down
   ```

### Docker Tips

- Use `docker-compose` for multi-service setups
- Set resource limits: `--memory=1g --cpus=1`
- Use named volumes for persistence: `-v trading-data:/app/data`
- Enable automatic restart: `--restart unless-stopped`

## VPS Deployment

### Prerequisites
- Ubuntu 20.04 LTS or newer
- 2GB+ RAM
- 10GB+ disk space
- SSH access

### Step-by-Step Setup

#### 1. Initial Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install git (if not present)
sudo apt install -y git
```

#### 2. Clone and Build

```bash
# Create app directory
sudo mkdir -p /opt/trading-bot
sudo chown $USER /opt/trading-bot

cd /opt/trading-bot

# Clone repository
git clone <your-repo-url> .

# Install dependencies
npm install

# Create environment
cp .env.example .env
# Edit .env with your API credentials and settings
nano .env

# Build TypeScript
npm run build
```

#### 3. PM2 Configuration

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup startup on reboot
pm2 startup

# Run the command output by the previous command (copy-paste the output)
# e.g., sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup ...
```

#### 4. Verify Deployment

```bash
# Check status
pm2 status

# View logs
pm2 logs trading-bot

# Monitor in real-time
pm2 monit
```

#### 5. Firewall Configuration

```bash
# Allow SSH (if using UFW)
sudo ufw allow 22/tcp

# Allow API port
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw enable
```

#### 6. Optional: Nginx Reverse Proxy

```bash
# Install nginx
sudo apt install -y nginx

# Create config
sudo nano /etc/nginx/sites-available/trading-bot
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/trading-bot /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
```

#### 7. SSL/TLS (Optional with Let's Encrypt)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal should be set up automatically
sudo systemctl restart certbot.timer
```

### Updating the Bot

```bash
cd /opt/trading-bot

# Pull latest changes
git pull origin main

# Install new dependencies if any
npm install

# Build
npm run build

# Restart PM2
pm2 restart trading-bot
```

### Backup Strategy

```bash
# Backup database daily
0 2 * * * cp /opt/trading-bot/data/trading.db /backups/trading-$(date +\%Y\%m\%d).db

# Backup logs weekly
0 3 * * 0 tar -czf /backups/logs-$(date +\%Y\%m\%d).tar.gz /opt/trading-bot/logs/

# Keep last 30 days
find /backups -name "trading-*.db" -mtime +30 -delete
find /backups -name "logs-*.tar.gz" -mtime +30 -delete
```

## Monitoring

### PM2 Dashboard

```bash
# Install PM2 Plus (optional, for web dashboard)
pm2 install pm2-auto-pull

# View web dashboard
pm2 web  # Access at http://localhost:9615

# Monitor in terminal
pm2 monit
```

### Health Checks

```bash
# API health check
curl http://localhost:3000/api/health

# Get bot status
curl http://localhost:3000/api/status

# Check if running
pm2 describe trading-bot
```

### Log Monitoring

```bash
# Follow logs
pm2 logs trading-bot

# View only errors
pm2 logs trading-bot --err

# View with timestamps
pm2 logs trading-bot --lines 100 --timestamp
```

### System Resources

```bash
# Check memory usage
pm2 monit

# Check disk space
df -h /opt/trading-bot

# Check database size
du -h /opt/trading-bot/data/

# Check log size
du -h /opt/trading-bot/logs/
```

## Troubleshooting

### Bot Won't Start

1. **Check logs**:
   ```bash
   pm2 logs trading-bot
   ```

2. **Verify configuration**:
   ```bash
   cat .env
   ```

3. **Check database**:
   ```bash
   sqlite3 data/trading.db ".tables"
   ```

4. **Reinstall and rebuild**:
   ```bash
   rm -rf dist node_modules
   npm install
   npm run build
   pm2 restart trading-bot
   ```

### WebSocket Connection Issues

1. **Check network**:
   ```bash
   ping stream.binance.com
   ```

2. **Check firewall**:
   ```bash
   nc -zv stream.binance.com 9443
   ```

3. **Review logs**:
   ```bash
   grep -i "websocket" logs/combined.log
   ```

### API Not Responding

1. **Check if running**:
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Check port**:
   ```bash
   netstat -tuln | grep 3000
   ```

3. **Check firewall**:
   ```bash
   sudo ufw status
   ```

### Database Locked

1. **Stop bot**:
   ```bash
   pm2 stop trading-bot
   ```

2. **Wait for locks to clear**:
   ```bash
   rm -f data/trading.db-wal data/trading.db-shm
   ```

3. **Restart**:
   ```bash
   pm2 restart trading-bot
   ```

### High Memory Usage

1. **Check memory**:
   ```bash
   pm2 monit
   ```

2. **Restart bot**:
   ```bash
   pm2 restart trading-bot
   ```

3. **Check for leaks**:
   ```bash
   grep -i "memory\|leak" logs/combined.log
   ```

### Performance Issues

1. **Check system load**:
   ```bash
   top -b -n 1 | head -15
   ```

2. **Review logs for slow operations**:
   ```bash
   grep "PERFORMANCE" logs/combined.log | tail -20
   ```

3. **Check database indices**:
   ```bash
   sqlite3 data/trading.db "SELECT * FROM sqlite_master WHERE type='index';"
   ```

## Production Checklist

- [ ] Environment variables configured
- [ ] Database backed up
- [ ] Logs rotation set up
- [ ] Monitoring configured
- [ ] Firewall rules applied
- [ ] SSL/TLS certificate installed (if using domain)
- [ ] API key has only necessary permissions
- [ ] Startup script tested
- [ ] Crash recovery tested
- [ ] Performance verified

## Support

For issues during deployment:
1. Check logs: `pm2 logs trading-bot`
2. Verify configuration: `cat .env`
3. Test API: `curl http://localhost:3000/api/health`
4. Review this guide for your specific issue
