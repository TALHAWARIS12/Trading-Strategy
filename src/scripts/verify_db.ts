import { database } from '@/database';
import logger from '@/logging';

async function verifyDb() {
  try {
    logger.info('Initializing DB connection...');
    await database.initialize();

    logger.info('Reading persisted trades...');
    const openTrades = await database.getOpenTrades();
    const closedTrades = await database.getClosedTrades();

    logger.info(`Found ${openTrades.length} open trades and ${closedTrades.length} closed trades in database.`);
    
    if (openTrades.length > 0) {
      logger.info('Open Trades Sample:');
      for (const t of openTrades.slice(0, 3)) {
        logger.info(`  [${t.side}] ${t.pair} entry: ${t.entryPrice} status: ${t.status}`);
      }
    }

    if (closedTrades.length > 0) {
      logger.info('Closed Trades Sample:');
      for (const t of closedTrades.slice(0, 3)) {
        logger.info(`  [${t.side}] ${t.pair} entry: ${t.entryPrice} exit: ${t.exitPrice} PnL: ${t.pnl} (${t.pnlPercent}%) reason: ${t.exitReason}`);
      }
    }

    logger.info('Reading persisted signals...');
    const signals = await database.getSignals(undefined, 10);
    logger.info(`Found ${signals.length} signals in database.`);
    if (signals.length > 0) {
      logger.info('Signals Sample:');
      for (const s of signals.slice(0, 3)) {
        logger.info(`  [${s.type}] ${s.pair} price: ${s.price} reason: ${s.reason}`);
      }
    }

    await database.close();
    logger.info('DB verification complete.');
  } catch (error) {
    logger.error(`Verification failed: ${error}`);
    process.exit(1);
  }
}

verifyDb();
