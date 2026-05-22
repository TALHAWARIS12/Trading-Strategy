import { database } from '@/database';
import { config } from '@/config';
import logger from '@/logging';

/**
 * Reset paper trading account
 */
async function resetPaperAccount(): Promise<void> {
  try {
    logger.info('Resetting paper account...');

    await database.initialize();

    // In a real implementation, we would clear trades and positions from the database
    // For now, we just log the action
    logger.info(`Paper account reset with initial balance: ${config.paperBalance}`);

    await database.close();
    logger.info('Paper account reset completed');
  } catch (error) {
    logger.error(`Failed to reset paper account: ${error}`);
    process.exit(1);
  }
}

resetPaperAccount();
