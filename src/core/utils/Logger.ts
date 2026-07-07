export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Silent = 4,
}

let globalLevel: LogLevel = import.meta.env?.DEV ? LogLevel.Debug : LogLevel.Info;

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const tag = `[${scope}]`;
  return {
    debug(...args: unknown[]): void {
      if (globalLevel <= LogLevel.Debug) console.debug(tag, ...args);
    },
    info(...args: unknown[]): void {
      if (globalLevel <= LogLevel.Info) console.info(tag, ...args);
    },
    warn(...args: unknown[]): void {
      if (globalLevel <= LogLevel.Warn) console.warn(tag, ...args);
    },
    error(...args: unknown[]): void {
      if (globalLevel <= LogLevel.Error) console.error(tag, ...args);
    },
  };
}
