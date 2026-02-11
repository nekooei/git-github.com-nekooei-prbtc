import pino, { Logger as PinoLogger } from 'pino';

export interface LoggerOptions {
  level?: 'debug' | 'info' | 'warn' | 'error';
  pretty?: boolean;
  name?: string;
}

export class Logger {
  private logger: PinoLogger;

  constructor(options: LoggerOptions = {}) {
    const { level = 'info', pretty = process.env.NODE_ENV !== 'production', name } = options;

    this.logger = pino({
      name,
      level,
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
      serializers: {
        error: pino.stdSerializers.err,
      },
    });
  }

  debug(obj: unknown, msg?: string): void;
  debug(msg: string): void;
  debug(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.debug(objOrMsg);
    } else {
      this.logger.debug(objOrMsg, msg);
    }
  }

  info(obj: unknown, msg?: string): void;
  info(msg: string): void;
  info(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.info(objOrMsg);
    } else {
      this.logger.info(objOrMsg, msg);
    }
  }

  warn(obj: unknown, msg?: string): void;
  warn(msg: string): void;
  warn(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.warn(objOrMsg);
    } else {
      this.logger.warn(objOrMsg, msg);
    }
  }

  error(obj: unknown, msg?: string): void;
  error(msg: string): void;
  error(objOrMsg: unknown, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.logger.error(objOrMsg);
    } else {
      this.logger.error(objOrMsg, msg);
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    const childLogger = new Logger({ level: this.logger.level as any });
    childLogger.logger = this.logger.child(bindings);
    return childLogger;
  }
}

export const createLogger = (options?: LoggerOptions): Logger => new Logger(options);
