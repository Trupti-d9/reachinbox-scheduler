/* Minimal structured logger — keeps dependencies small. */
type Level = 'debug' | 'info' | 'warn' | 'error';

function log(level: Level, scope: string, msg: string, meta?: Record<string, unknown>) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const out = meta && Object.keys(meta).length ? `${line} ${JSON.stringify(meta)}` : line;
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const createLogger = (scope: string) => ({
  debug: (m: string, meta?: Record<string, unknown>) => process.env.DEBUG && log('debug', scope, m, meta),
  info: (m: string, meta?: Record<string, unknown>) => log('info', scope, m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log('warn', scope, m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log('error', scope, m, meta),
});
