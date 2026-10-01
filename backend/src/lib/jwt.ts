import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessClaims {
  sub: string;
  role: 'user' | 'admin';
  username: string;
}

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const signAccess = (c: AccessClaims) =>
  jwt.sign(c, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL_SEC, issuer: 'y2markets' });

export const verifyAccess = (token: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'y2markets' }) as AccessClaims & jwt.JwtPayload;

/** Short-lived ticket used between password check and 2FA code entry. */
export const signTwoFactorTicket = (userId: string) =>
  jwt.sign({ sub: userId, purpose: '2fa' }, env.JWT_REFRESH_SECRET, { expiresIn: 300, issuer: 'y2markets' });

export function verifyTwoFactorTicket(ticket: string): string {
  const p = jwt.verify(ticket, env.JWT_REFRESH_SECRET, { issuer: 'y2markets' }) as jwt.JwtPayload;
  if (p['purpose'] !== '2fa' || !p.sub) throw new Error('bad ticket');
  return p.sub;
}
