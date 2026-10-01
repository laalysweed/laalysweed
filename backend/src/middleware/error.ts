import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { isProd } from '../config/env';

const log = createLogger('http');

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const e = err as { code?: number; type?: string; message?: string; status?: number };
  if (e?.code === 11000) {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'Already exists' } });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
    return;
  }
  if (e?.status === 413 || e?.message === 'File too large') {
    res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Upload too large' } });
    return;
  }
  log.error(`${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: isProd ? 'Something went wrong' : String(e?.message ?? err) } });
}
