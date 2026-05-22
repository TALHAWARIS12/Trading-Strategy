import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from '@/config';

// Ensure logs directory exists
if (!fs.existsSync(config.logPath)) {
  fs.mkdirSync(config.logPath, { recursive: true });
}

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) =>
      `${info.timestamp} ${info.level}: ${info.message}` +
      (info.metadata ? JSON.stringify(info.metadata, null, 2) : '')
  )
);

const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      format
    ),
  }),

  // File transports
  new winston.transports.File({
    filename: path.join(config.logPath, 'error.log'),
    level: 'error',
    format,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),

  new winston.transports.File({
    filename: path.join(config.logPath, 'combined.log'),
    format,
    maxsize: 5242880, // 5MB
    maxFiles: 10,
  }),

  new winston.transports.File({
    filename: path.join(config.logPath, 'trades.log'),
    format,
    maxsize: 5242880, // 5MB
    maxFiles: 20,
  }),
];

const logger = winston.createLogger({
  level: config.logLevel,
  levels,
  format,
  transports,
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(config.logPath, 'exceptions.log'),
      format,
    }),
  ],
});

// Helper functions for specialized logging
export const logTrade = (tradeData: any) => {
  logger.info('TRADE_EVENT', {
    metadata: tradeData,
  });
};

export const logSignal = (signalData: any) => {
  logger.info('SIGNAL_EVENT', {
    metadata: signalData,
  });
};

export const logWebSocket = (wsData: any) => {
  logger.debug('WEBSOCKET_EVENT', {
    metadata: wsData,
  });
};

export const logError = (error: Error, context?: string) => {
  logger.error(`ERROR${context ? ` [${context}]` : ''}: ${error.message}`, {
    metadata: {
      stack: error.stack,
    },
  });
};

export const logPerformance = (metric: string, value: number) => {
  logger.debug(`PERFORMANCE: ${metric}=${value}ms`);
};

export default logger;
