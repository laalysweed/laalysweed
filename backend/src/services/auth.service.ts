import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { ClientSession, Types } from 'mongoose';
import { Session, User, UserT } from '../models/user';
import { Account } from '../models/account';
import { env } from '../config/env';
import { randomToken, sha256 } from '../lib/crypto';
import { REFRESH_TTL_MS, signAccess } from '../lib/jwt';
import { badRequest, unauthorized } from '../lib/errors';
import { postEntry } from './ledger.service';
import { getBonusConfig } from './settings.service';
import { mailCanSend, sendMail } from '../lib/mailer';
import crypto from 'node:crypto';

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

// Over HTTPS the frontend (e.g. Cloudflare Pages) and API (e.g. Render) may live on different sites,
// so the refresh cookie must be SameSite=None to be sent on cross-site requests.
const cookieBase = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SECURE ? ('none' as const) : ('lax' as const),
  path: '/api/auth',
});

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieBase(), maxAge: REFRESH_TTL_MS });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, cookieBase());
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

/* ---------- 6-digit e-mail verification codes ---------- */

export const CODE_TTL_MS = 15 * 60_000;
export const CODE_RESEND_COOLDOWN_MS = 60_000;
const CODE_MAX_ATTEMPTS = 5;
const codeHash = (userId: string, code: string) => sha256(`${userId}:${code}:${env.JWT_REFRESH_SECRET}`);

/** "jane.doe@gmail.com" → "ja•••@gmail.com" */
export const maskEmail = (e: string) => e.replace(/^(.{1,2})[^@]*(@.*)$/, (_m, a: string, b: string) => `${a}•••${b}`);

/** Seconds until another code may be sent (0 = now). */
export function codeCooldown(u: Pick<UserT, 'emailCode'>) {
  const sentAt = u.emailCode?.sentAt ? new Date(u.emailCode.sentAt).getTime() : 0;
  return Math.max(0, Math.ceil((sentAt + CODE_RESEND_COOLDOWN_MS - Date.now()) / 1000));
}

/** Generates, stores (hashed) and e-mails a fresh code. Resolves false when the e-mail could not be sent. */
export async function sendVerificationCode(userId: Types.ObjectId | string): Promise<boolean> {
  if (!(await mailCanSend())) return false;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const u = await User.findByIdAndUpdate(
    userId,
    { $set: { emailCode: { hash: codeHash(String(userId), code), expires: new Date(Date.now() + CODE_TTL_MS), attempts: 0, sentAt: new Date() } } },
    { new: true },
  ).lean();
  if (!u) return false;
  const first = u.fullName.split(' ')[0]?.replace(/[<>&]/g, '') ?? '';
  const body = `Use this code to verify your e-mail address and finish signing in to Y2 Markets:
    <div style="margin:22px 0 8px;font-size:34px;font-weight:800;letter-spacing:10px;color:#E6EAF2;font-family:'Courier New',monospace">${code}</div>
    The code expires in 15 minutes. If you did not create a Y2 Markets account, you can ignore this e-mail.`;
  const sent = await sendMail(u.email, `${code} is your Y2 Markets verification code`, `Hi ${first}, verify your e-mail`, body);
  if (!sent) await User.updateOne({ _id: u._id }, { $unset: { emailCode: 1 } });
  return sent;
}

/** Checks a code; on success marks the e-mail verified. Throws a user-facing error otherwise. */
export async function confirmVerificationCode(userId: string, code: string) {
  const u = await User.findById(userId, { emailCode: 1, emailVerified: 1 }).lean<UserT>();
  if (!u) throw unauthorized('Account unavailable', 'NO_SESSION');
  if (u.emailVerified) return;
  const c = u.emailCode;
  if (!c?.hash || !c.expires || new Date(c.expires).getTime() < Date.now()) throw badRequest('This code has expired. Tap "Resend code" to get a new one.', 'CODE_EXPIRED');
  if ((c.attempts ?? 0) >= CODE_MAX_ATTEMPTS) throw badRequest('Too many wrong attempts. Tap "Resend code" to get a new one.', 'CODE_LOCKED');
  if (codeHash(userId, code) !== c.hash) {
    await User.updateOne({ _id: userId }, { $inc: { 'emailCode.attempts': 1 } });
    const left = CODE_MAX_ATTEMPTS - (c.attempts ?? 0) - 1;
    throw badRequest(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Tap "Resend code" to get a new one.', 'BAD_CODE');
  }
  await User.updateOne({ _id: userId }, { $set: { emailVerified: true }, $unset: { emailCode: 1, emailVerifyTokenHash: 1, emailVerifyExpires: 1 } });
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
