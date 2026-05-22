import axios from 'axios';
import logger from '@/logging';

async function testApi() {
  const baseURL = 'http://localhost:3000/api';
  logger.info(`Starting API endpoints verification against ${baseURL}...`);

  const endpoints = [
    { name: 'Health', path: '/health' },
    { name: 'Status', path: '/status' },
    { name: 'Performance', path: '/performance' },
    { name: 'Positions', path: '/positions' },
    { name: 'Trades', path: '/trades' },
    { name: 'Signals', path: '/signals' },
    { name: 'Candles', path: '/candles' },
    { name: 'Logs', path: '/logs' }
  ];

  for (const ep of endpoints) {
    try {
      logger.info(`Testing [GET] ${ep.path}...`);
      const response = await axios.get(`${baseURL}${ep.path}`);
      logger.info(`  [GET] ${ep.path} Status: ${response.status} ${response.statusText}`);
      
      if (ep.path === '/health') {
        logger.info(`  Response: ${JSON.stringify(response.data)}`);
      } else if (ep.path === '/status') {
        logger.info(`  Health Status: ${response.data.health}`);
        logger.info(`  Running Status: ${response.data.running}`);
        logger.info(`  Connected Pairs: ${JSON.stringify(response.data.connectedPairs)}`);
      } else if (ep.path === '/performance') {
        logger.info(`  Balance: ${response.data.totalBalance}`);
        logger.info(`  Realized PnL: ${response.data.realizedPnL}`);
        logger.info(`  Unrealized PnL: ${response.data.unrealizedPnL}`);
        logger.info(`  Total Trades: ${response.data.closedTrades}`);
      } else if (ep.path === '/positions') {
        logger.info(`  Positions Count: ${response.data.count}`);
        if (response.data.positions && response.data.positions.length > 0) {
          logger.info(`  First Position Pair: ${response.data.positions[0].pair}`);
        }
      } else if (ep.path === '/trades') {
        logger.info(`  Closed Trades Count: ${response.data.count}`);
      } else if (ep.path === '/signals') {
        logger.info(`  Signals Count: ${response.data.count}`);
      } else if (ep.path === '/candles') {
        logger.info(`  Candles Count: ${response.data.count}`);
      } else if (ep.path === '/logs') {
        logger.info(`  Logs Count: ${response.data.count}`);
        if (response.data.logs && response.data.logs.length > 0) {
          logger.info(`  Last log line: ${response.data.logs[response.data.logs.length - 1]}`);
        }
      }
    } catch (err: any) {
      logger.error(`  Error requesting ${ep.path}: ${err.message}`);
    }
  }

  logger.info('API endpoints verification complete.');
}

testApi();
