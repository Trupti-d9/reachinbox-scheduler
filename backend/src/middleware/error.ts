import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { createLogger } from '../lib/logger';

const log = createLogger('http');

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Wraps async route handlers so rejected promises reach the error handler. */
export const asyncHandler =
  <T extends Request = Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req as T, res, next).catch(next);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  log.error('unhandled error', { err: err instanceof Error ? err.stack : String(err) });
  return res.status(500).json({ error: 'Internal server error' });
}
