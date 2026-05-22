import { BotStatus } from '@/types';
import { wsManager } from '@/websocket';
import logger from '@/logging';

export class HealthMonitor {
  private startTime: number = Date.now();
  private lastHealthCheck: number = Date.now();
  private isHealthy: boolean = true;
  private checksCount: number = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Start health monitoring
   */
  start(intervalMs: number = 30000): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
    logger.info('Health monitor started');
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    this.checksCount++;
    this.lastHealthCheck = Date.now();

    try {
      const status = wsManager.getConnectionStatus();
      const connectedCount = Object.values(status).filter((v) => v).length;
      const totalCount = Object.keys(status).length;

      if (connectedCount < totalCount / 2) {
        this.isHealthy = false;
        logger.warn(`Health check failed: only ${connectedCount}/${totalCount} WebSocket connections active`);
      } else {
        this.isHealthy = true;
        logger.debug(`Health check passed: ${connectedCount}/${totalCount} connections active`);
      }
    } catch (error) {
      this.isHealthy = false;
      logger.error(`Health check error: ${error}`);
    }
  }

  /**
   * Get bot status
   */
  getStatus(
    running: boolean,
    connectedPairs: string[],
    activePositions: number,
    totalBalance: number
  ): BotStatus {
    const uptime = Date.now() - this.startTime;

    return {
      running,
      connectedPairs,
      activePositions,
      totalBalance,
      lastUpdateTime: this.lastHealthCheck,
      uptime,
      health: this.isHealthy ? 'HEALTHY' : 'DEGRADED',
    };
  }

  /**
   * Check if system is healthy
   */
  isSystemHealthy(): boolean {
    return this.isHealthy;
  }

  /**
   * Reset uptime counter
   */
  resetUptime(): void {
    this.startTime = Date.now();
  }
}

export const healthMonitor = new HealthMonitor();
