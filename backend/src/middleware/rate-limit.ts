import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { isTest } from '../config/env';

const skip = () => isTest;

export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, skip });

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again in a few minutes' } },
});

/** Per-user limiter for trade placement (falls back to IP). */
export const tradeLimiter = rateLimit({
  windowMs: 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  keyGenerator: (req: Request) => req.auth?.sub ?? req.ip ?? 'anon',
  message: { error: { code: 'RATE_LIMITED', message: 'Slow down: too many orders per second' } },
});
