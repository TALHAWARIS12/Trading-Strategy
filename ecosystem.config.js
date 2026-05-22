module.exports = {
  apps: [
    {
      name: 'trading-bot',
      script: './dist/app.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 3000,
      kill_timeout: 5000,
      wait_ready: true,
      events: {
        restart: 'echo "App restarted"',
        reload: 'echo "App reloaded"',
        stop: 'echo "App stopped"',
        exit: 'echo "App exited"',
        'restart overlimit': 'echo "PM2 restart overlimit"',
      },
    },
  ],
  deploy: {
    production: {
      user: 'ubuntu',
      host: '0.0.0.0',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/crypto-trading-bot.git',
      path: '/home/ubuntu/crypto-trading-bot',
      'post-deploy':
        'npm install && npm run build && pm2 restart trading-bot',
    },
  },
};
