import type { NextFunction, Request, Response } from 'express';
import { AccessClaims, verifyAccess } from '../lib/jwt';
import { forbidden, unauthorized } from '../lib/errors';
import { User } from '../models/user';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AccessClaims;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(unauthorized());
  try {
    const c = verifyAccess(h.slice(7));
    req.auth = { sub: c.sub, role: c.role, username: c.username };
    next();
  } catch {
    next(unauthorized('Session expired', 'TOKEN_EXPIRED'));
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    // Re-check role in DB so a demoted admin loses access immediately, not after token expiry.
    User.findById(req.auth!.sub, { role: 1, blocked: 1 })
      .lean()
      .then((u) => (u && u.role === 'admin' && !u.blocked ? next() : next(forbidden())))
      .catch(next);
  });
}

export const uid = (req: Request) => req.auth!.sub;
