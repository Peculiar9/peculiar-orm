export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARNING = 'WARNING',
    ERROR = 'ERROR'
}

export interface ILogger {
    write(message: string, level: LogLevel, metadata?: any): void;
    debug(message: string, metadata?: any): void;
    info(message: string, metadata?: any): void;
    warn(message: string, metadata?: any): void;
    error(message: string | Error, metadata?: any): void;
}

export class ConsoleLogger implements ILogger {
    write(message: string, level: LogLevel, metadata?: any): void {
        const timestamp = new Date().toISOString();
        const metaStr = metadata ? JSON.stringify(metadata) : '';
        console.log(`[${timestamp}] [${level}] ${message} ${metaStr}`);
    }

    debug(message: string, metadata?: any): void {
        this.write(message, LogLevel.DEBUG, metadata);
    }

    info(message: string, metadata?: any): void {
        this.write(message, LogLevel.INFO, metadata);
    }

    warn(message: string, metadata?: any): void {
        this.write(message, LogLevel.WARNING, metadata);
    }

    error(message: string | Error, metadata?: any): void {
        const msg = message instanceof Error ? message.message : message;
        const meta = message instanceof Error ? { ...metadata, stack: message.stack } : metadata;
        this.write(msg, LogLevel.ERROR, meta);
    }
}

export const Logger = new ConsoleLogger();
