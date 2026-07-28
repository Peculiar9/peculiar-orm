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

// --- level gating -----------------------------------------------------------
// Ordered so a threshold suppresses everything below it. Set LOG_LEVEL (or
// PECULIAR_LOG_LEVEL) to debug|info|warn|error|silent; default `info` keeps the
// important logs while dropping the per-connection/per-query DEBUG chatter that
// otherwise floods startup.
const RANK: Record<string, number> = {
    DEBUG: 10, INFO: 20, WARN: 30, WARNING: 30, ERROR: 40, SILENT: 100,
};
function threshold(): number {
    const env = (process.env.LOG_LEVEL ?? process.env.PECULIAR_LOG_LEVEL ?? 'info').toUpperCase();
    return RANK[env] ?? RANK.INFO;
}

// --- color (NestJS-flavoured, but warm) -------------------------------------
// Only when writing to a TTY and NO_COLOR isn't set — so redirected log files
// stay clean and parseable. Palette: an orange-brown brand as the spirit, a
// green timestamp accent, amber warnings and red errors.
const USE_COLOR = !!process.stdout.isTTY && process.env.NO_COLOR == null;
const paint = (code: string, s: string): string => (USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const BRAND = '38;5;173';   // orange-brown
const GREEN = '38;5;108';   // muted green (timestamp)
const META = '2;38;5;244';  // dim grey
const LEVEL_COLOR: Record<string, string> = {
    DEBUG: '38;5;245',       // grey
    INFO: '38;5;173',        // orange-brown
    WARNING: '1;38;5;179',   // amber, bold
    ERROR: '1;38;5;203',     // red, bold
};
const LEVEL_TAG: Record<string, string> = { DEBUG: 'DEBUG', INFO: 'INFO', WARNING: 'WARN', ERROR: 'ERROR' };

export class ConsoleLogger implements ILogger {
    write(message: string, level: LogLevel, metadata?: any): void {
        if ((RANK[level] ?? RANK.INFO) < threshold()) return;

        const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
        const hasMeta = metadata != null && (typeof metadata !== 'object' || Object.keys(metadata).length > 0);
        const metaStr = hasMeta ? ' ' + (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : '';
        const tag = (LEVEL_TAG[level] ?? level).padEnd(5);

        if (!USE_COLOR) {
            console.log(`◆ peculiar ${ts} ${tag} ${message}${metaStr}`);
            return;
        }

        const line =
            paint(BRAND, '◆ peculiar') + ' ' +
            paint(GREEN, ts) + ' ' +
            paint(LEVEL_COLOR[level] ?? BRAND, tag) + ' ' +
            (level === LogLevel.ERROR ? paint('38;5;203', message) : message) +
            (metaStr ? paint(META, metaStr) : '');
        console.log(line);
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
