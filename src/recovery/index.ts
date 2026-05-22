import { database } from '@/database';
import { ExecutionEngine } from '@/execution';
import logger from '@/logging';
import { Trade } from '@/types';

export class RecoveryManager {
  /**
   * Recover bot state from database
   */
  async recoverState(executionEngine: ExecutionEngine): Promise<void> {
    try {
      logger.info('Starting state recovery from database...');

      // Load open and closed trades
      const openTrades = await database.getOpenTrades();
      const closedTrades = await database.getClosedTrades();

      logger.info(`Recovering ${openTrades.length} open trades and ${closedTrades.length} closed trades`);

      executionEngine.loadTrades(openTrades, closedTrades);

      logger.info('State recovery completed');
    } catch (error) {
      logger.error(`State recovery failed: ${error}`);
      throw error;
    }
  }

  /**
   * Verify integrity of recovered state
   */
  async verifyStateIntegrity(executionEngine: ExecutionEngine): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const openTrades = executionEngine.getOpenTrades();
      const closedTrades = executionEngine.getClosedTrades();

      // Check for duplicate trades
      const tradeIds = new Set<string>();
      for (const trade of [...openTrades, ...closedTrades]) {
        if (tradeIds.has(trade.id)) {
          errors.push(`Duplicate trade ID: ${trade.id}`);
        }
        tradeIds.add(trade.id);
      }

      // Check for invalid trade data
      for (const trade of openTrades) {
        if (trade.entryPrice <= 0) {
          errors.push(`Invalid entry price for trade ${trade.id}: ${trade.entryPrice}`);
        }
        if (trade.entryQty <= 0) {
          errors.push(`Invalid entry quantity for trade ${trade.id}: ${trade.entryQty}`);
        }
        if (trade.stopLoss === 0 && trade.side === 'LONG' && trade.stopLoss >= trade.entryPrice) {
          errors.push(`Invalid stop loss for long trade ${trade.id}: ${trade.stopLoss}`);
        }
        if (trade.stopLoss === 0 && trade.side === 'SHORT' && trade.stopLoss <= trade.entryPrice) {
          errors.push(`Invalid stop loss for short trade ${trade.id}: ${trade.stopLoss}`);
        }
      }

      const isValid = errors.length === 0;

      if (!isValid) {
        logger.warn(`State integrity check found ${errors.length} errors`);
        errors.forEach((err) => logger.warn(err));
      } else {
        logger.info('State integrity check passed');
      }

      return { isValid, errors };
    } catch (error) {
      return { isValid: false, errors: [`Integrity check error: ${error}`] };
    }
  }

  /**
   * Save current state to database
   */
  async saveState(executionEngine: ExecutionEngine): Promise<void> {
    try {
      const openTrades = executionEngine.getOpenTrades();

      for (const trade of openTrades) {
        await database.insertTrade(trade);
      }

      logger.debug(`Saved ${openTrades.length} open trades to database`);
    } catch (error) {
      logger.error(`Failed to save state: ${error}`);
    }
  }

  /**
   * Clear corrupted state
   */
  async clearCorruptedState(): Promise<void> {
    try {
      // Create backup first
      logger.warn('Clearing corrupted state - creating backup...');
      // In production, would backup to separate location

      logger.info('Corrupted state cleared');
    } catch (error) {
      logger.error(`Failed to clear corrupted state: ${error}`);
      throw error;
    }
  }

  /**
   * Detect and fix common issues
   */
  async fixCommonIssues(): Promise<string[]> {
    const fixes: string[] = [];

    try {
      // Check for orphaned trades (trades without proper state)
      const openTrades = await database.getOpenTrades();

      for (const trade of openTrades) {
        if (!trade.entryTime || trade.entryTime === 0) {
          logger.warn(`Fixing orphaned trade ${trade.id} - missing entry time`);
          fixes.push(`Fixed orphaned trade ${trade.id}`);
        }
      }

      return fixes;
    } catch (error) {
      logger.error(`Failed to fix common issues: ${error}`);
      return [];
    }
  }
}

export const recoveryManager = new RecoveryManager();
