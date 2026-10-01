import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { ClientSession, Types } from 'mongoose';
import { Session, User, UserT } from '../models/user';
import { Account } from '../models/account';
import { env } from '../config/env';
import { randomToken, sha256 } from '../lib/crypto';
import { REFRESH_TTL_MS, signAccess } from '../lib/jwt';
import { unauthorized } from '../lib/errors';
import { postEntry } from './ledger.service';
import { getBonusConfig } from './settings.service';
import { sendMail } from '../lib/mailer';

export const REFRESH_COOKIE = 'y2_rt';
const BCRYPT_ROUNDS = 12;

export const hashPassword = (p: string) => bcrypt.hash(p, BCRYPT_ROUNDS);
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h);

export const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'support', 'help', 'y2', 'y2markets', 'root', 'system', 'moderator', 'staff']);

/** Creates the user plus DEMO ($10,000 via ledger) and REAL ($0) accounts, inside a transaction. */
export async function createUserWithAccounts(
  session: ClientSession,
  data: { fullName: string; username: string; email: string; password: string; referredBy?: Types.ObjectId; role?: 'user' | 'admin'; emailVerified?: boolean },
) {
  const cfg = await getBonusConfig();
  const userId = new Types.ObjectId();
  const demoId = new Types.ObjectId();
  const realId = new Types.ObjectId();
  const [user] = await User.create(
    [
      {
        _id: userId,
        fullName: data.fullName,
        username: data.username,
        email: data.email,
        passwordHash: await hashPassword(data.password),
        referredBy: data.referredBy,
        role: data.role ?? 'user',
        emailVerified: data.emailVerified ?? false,
        activeAccountId: demoId,
      },
    ],
    { session },
  );
  await Account.create(
    [
      { _id: demoId, userId, type: 'demo', balance: 0 },
      { _id: realId, userId, type: 'real', balance: 0 },
    ],
    { session, ordered: true },
  );
  if (cfg.demoBalance > 0) await postEntry(session, { accountId: demoId, type: 'demo_credit', bucket: 'cash', amount: cfg.demoBalance, note: 'Demo starting balance' });
  return user!;
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

/** Issues an access token and a rotating refresh token (stored hashed, grouped by family). */
export async function issueSession(req: Request, res: Response, user: UserT, family?: string) {
  const refresh = randomToken(48);
  await Session.create({
    userId: user._id,
    tokenHash: sha256(refresh),
    family: family ?? randomToken(12),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: req.headers['user-agent']?.slice(0, 200),
    ip: req.ip,
  });
  setRefreshCookie(res, refresh);
  return signAccess({ sub: String(user._id), role: user.role as 'user' | 'admin', username: user.username });
}

/**
 * Refresh-token rotation with reuse detection: presenting an already-rotated token
 * revokes the whole family (someone stole a token).
 */
export async function rotateSession(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw unauthorized('No session', 'NO_SESSION');
  const s = await Session.findOne({ tokenHash: sha256(token) });
  if (!s) throw unauthorized('Session not found', 'NO_SESSION');
  if (s.revokedAt || s.replacedAt) {
    await Session.updateMany({ family: s.family }, { $set: { revokedAt: new Date() } });
    clearRefreshCookie(res);
    throw unauthorized('Session revoked', 'SESSION_REUSED');
  }
  if (s.expiresAt.getTime() < Date.now()) throw unauthorized('Session expired', 'NO_SESSION');
  const user = await User.findById(s.userId).lean<UserT>();
  if (!user || user.blocked) throw unauthorized('Account unavailable', 'NO_SESSION');
  // Grace: mark rotated (not revoked) so the reuse check above catches replays.
  s.replacedAt = new Date();
  await s.save();
  const accessToken = await issueSession(req, res, user, s.family);
  return { user, accessToken };
}

export async function revokeCurrent(req: Request) {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) await Session.updateOne({ tokenHash: sha256(token) }, { $set: { revokedAt: new Date() } });
}

export async function sendVerificationEmail(userId: Types.ObjectId | string) {
  const token = randomToken(32);
  const u = await User.findByIdAndUpdate(
    userId,
    { $set: { emailVerifyTokenHash: sha256(token), emailVerifyExpires: new Date(Date.now() + 48 * 3600_000) } },
    { new: true },
  ).lean();
  if (!u) return;
  await sendMail(u.email, 'Verify your e-mail', `Welcome, ${u.fullName.split(' ')[0]?.replace(/[<>&]/g, '')}!`, 'Confirm your e-mail address to secure your account and enable withdrawals.', {
    label: 'Verify e-mail',
    url: `${env.APP_URL}/verify-email?token=${token}`,
  });
}

export async function sendPasswordReset(email: string) {
  const token = randomToken(32);
  const u = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { $set: { resetTokenHash: sha256(token), resetExpires: new Date(Date.now() + 3600_000) } },
    { new: true },
  ).lean();
  if (!u) return; // do not reveal whether the e-mail exists
  await sendMail(u.email, 'Reset your password', 'Password reset', 'We received a request to reset your password. The link is valid for 1 hour. If you did not request this, ignore this e-mail.', {
    label: 'Reset password',
    url: `${env.APP_URL}/?auth=reset&token=${token}`,
  });
}
