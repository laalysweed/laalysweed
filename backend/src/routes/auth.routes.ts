import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { authenticator } from 'otplib';
import { ah, parse } from '../lib/http';
import { authLimiter } from '../middleware/rate-limit';
import { requireAuth, uid } from '../middleware/auth';
import { User, UserT, publicUser, Session } from '../models/user';
import { AppError, badRequest, conflict, unauthorized } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { signTwoFactorTicket, signVerifyTicket, verifyTwoFactorTicket, verifyVerifyTicket } from '../lib/jwt';
import { mailCanSend } from '../lib/mailer';
import { withTxn } from '../services/ledger.service';
import { ChatMessage } from '../models/misc';
import {
  RESERVED_USERNAMES,
  REFRESH_COOKIE,
  clearRefreshCookie,
  createUserWithAccounts,
  hashPassword,
  issueSession,
  revokeCurrent,
  rotateSession,
  sendPasswordReset,
  CODE_RESEND_COOLDOWN_MS,
  codeCooldown,
  confirmVerificationCode,
  maskEmail,
  sendVerificationCode,
  verifyPassword,
} from '../services/auth.service';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, 'Use 3–20 letters, numbers or underscores');
export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a number');

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(80),
  username: usernameSchema,
  email: z.string().trim().toLowerCase().email('Enter a valid e-mail'),
  password: passwordSchema,
  referrer: z.string().trim().toLowerCase().max(20).optional().or(z.literal('')),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms & Conditions' }) }),
});

export const authRouter = Router();

authRouter.get(
  '/check',
  ah(async (req, res) => {
    const q = parse(z.object({ username: z.string().optional(), email: z.string().optional() }), req.query);
    if (q.username) {
      const r = usernameSchema.safeParse(q.username);
      if (!r.success) return res.json({ available: false, reason: r.error.issues[0]?.message });
      if (RESERVED_USERNAMES.has(r.data)) return res.json({ available: false, reason: 'This username is reserved' });
      return res.json({ available: !(await User.exists({ username: r.data })) });
    }
    if (q.email) {
      const r = z.string().email().safeParse(q.email.trim().toLowerCase());
      if (!r.success) return res.json({ available: false, reason: 'Enter a valid e-mail' });
      return res.json({ available: !(await User.exists({ email: r.data })) });
    }
    throw badRequest('username or email required');
  }),
);

authRouter.get(
  '/referrer/:username',
  ah(async (req, res) => {
    const u = await User.findOne({ username: String(req.params['username']).toLowerCase() }, { username: 1 }).lean();
    res.json({ valid: !!u });
  }),
);

authRouter.post(
  '/register',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(registerSchema, req.body);
    if (RESERVED_USERNAMES.has(b.username)) throw conflict('This username is reserved', 'USERNAME_TAKEN');
    if (await User.exists({ username: b.username })) throw conflict('Username is already taken', 'USERNAME_TAKEN');
    if (await User.exists({ email: b.email })) throw conflict('An account with this e-mail already exists', 'EMAIL_TAKEN');
    let referredBy: Types.ObjectId | undefined;
    if (b.referrer) {
      const ref = await User.findOne({ username: b.referrer }, { _id: 1 }).lean();
      if (!ref) throw badRequest('Referrer not found', 'BAD_REFERRER');
      referredBy = ref._id;
    }
    const user = await withTxn((s) => createUserWithAccounts(s, { fullName: b.fullName, username: b.username, email: b.email, password: b.password, referredBy }));
    void ChatMessage.create({
      conversationUserId: user._id,
      from: 'support',
      text: `Hi ${b.fullName.split(' ')[0]}! 👋 Welcome to Y2 Markets. We're here 24/7 if you need help with deposits, withdrawals or the platform.`,
    });
    // E-mail a 6-digit code; the account opens only after it is entered.
    // If no e-mail can be sent (e.g. free credits used up), sign the user straight in as before.
    if (await sendVerificationCode(user._id)) return res.status(201).json(verificationStep(user));
    const u = user.toObject() as UserT;
    const accessToken = await issueSession(req, res, u);
    res.status(201).json({ accessToken, user: publicUser(u) });
  }),
);

/** Response telling the client to show the "enter your code" screen. */
function verificationStep(u: Pick<UserT, '_id' | 'email' | 'emailCode'>) {
  return {
    verificationRequired: true as const,
    ticket: signVerifyTicket(String(u._id)),
    email: maskEmail(u.email),
    resendIn: Math.ceil(CODE_RESEND_COOLDOWN_MS / 1000),
  };
}

/** Last step of any sign-in: 2FA challenge if enabled, otherwise a session. */
async function completeSignIn(req: Request, res: Response, user: UserT) {
  if (user.twoFactor?.enabled) return res.json({ twoFactorRequired: true, ticket: signTwoFactorTicket(String(user._id)) });
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), lastIp: req.ip } });
  const accessToken = await issueSession(req, res, user);
  return res.json({ accessToken, user: publicUser(user) });
}

const ticketUser = (ticket: string) => {
  try {
    return verifyVerifyTicket(ticket);
  } catch {
    throw unauthorized('This verification session has expired. Please sign in again.', 'TICKET_EXPIRED');
  }
};

authRouter.post(
  '/login',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ identifier: z.string().trim().toLowerCase().min(3), password: z.string().min(1) }), req.body);
    const user = await User.findOne({ $or: [{ email: b.identifier }, { username: b.identifier }] }).lean<UserT>();
    // constant-ish time: always run bcrypt
    const ok = await verifyPassword(b.password, user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    if (!user || !ok) throw unauthorized('Incorrect e-mail/username or password', 'BAD_CREDENTIALS');
    if (user.blocked) throw unauthorized('This account has been suspended. Contact support.', 'BLOCKED');
    // Unverified players must enter an e-mail code first, but only while e-mail can actually be sent.
    if (!user.emailVerified && user.role !== 'admin' && (await mailCanSend())) {
      const live = user.emailCode?.expires && new Date(user.emailCode.expires).getTime() > Date.now() && (user.emailCode.attempts ?? 0) < 5;
      if ((live && codeCooldown(user) > 0) || (await sendVerificationCode(user._id))) {
        const fresh = await User.findById(user._id, { email: 1, emailCode: 1 }).lean<UserT>();
        return res.json({ ...verificationStep(fresh!), resendIn: codeCooldown(fresh!) });
      }
    }
    await completeSignIn(req, res, user);
  }),
);

authRouter.post(
  '/verify-code',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ ticket: z.string(), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
    const userId = ticketUser(b.ticket);
    await confirmVerificationCode(userId, b.code);
    const user = await User.findById(userId).lean<UserT>();
    if (!user || user.blocked) throw unauthorized('Account unavailable', 'NO_SESSION');
    await completeSignIn(req, res, user);
  }),
);

authRouter.post(
  '/resend-code',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ ticket: z.string() }), req.body);
    const user = await User.findById(ticketUser(b.ticket)).lean<UserT>();
    if (!user || user.blocked) throw unauthorized('Account unavailable', 'NO_SESSION');
    if (user.emailVerified) return completeSignIn(req, res, user);
    const wait = codeCooldown(user);
    if (wait > 0) return res.status(429).json({ error: { code: 'COOLDOWN', message: `Please wait ${wait}s before requesting another code.` }, resendIn: wait });
    // E-mail unavailable (credits used up): don't lock the player out, let them in as before.
    if (!(await sendVerificationCode(user._id))) return completeSignIn(req, res, user);
    res.json({ ok: true, email: maskEmail(user.email), resendIn: Math.ceil(CODE_RESEND_COOLDOWN_MS / 1000) });
  }),
);

authRouter.post(
  '/login/2fa',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ ticket: z.string(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
    let userId: string;
    try {
      userId = verifyTwoFactorTicket(b.ticket);
    } catch {
      throw unauthorized('Login expired, please sign in again', 'TICKET_EXPIRED');
    }
    const user = await User.findById(userId).lean<UserT>();
    if (!user?.twoFactor?.enabled || !user.twoFactor.secret) throw unauthorized();
    if (!authenticator.verify({ token: b.code, secret: user.twoFactor.secret })) throw unauthorized('Invalid code', 'BAD_2FA');
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), lastIp: req.ip } });
    const accessToken = await issueSession(req, res, user);
    res.json({ accessToken, user: publicUser(user) });
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    // No cookie = anonymous visitor: answer 204 instead of 401 so the browser console stays clean.
    if (!req.cookies?.[REFRESH_COOKIE]) return res.status(204).end();
    const { user, accessToken } = await rotateSession(req, res);
    res.json({ accessToken, user: publicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    await revokeCurrent(req);
    clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  ah(async (req, res) => {
    await Session.updateMany({ userId: uid(req), revokedAt: null }, { $set: { revokedAt: new Date() } });
    clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/forgot',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().email() }), req.body);
    await sendPasswordReset(b.email);
    res.json({ ok: true, message: 'If an account exists for that e-mail, a reset link is on its way.' });
  }),
);

authRouter.post(
  '/reset',
  authLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ token: z.string().min(20), password: passwordSchema }), req.body);
    const user = await User.findOne({ resetTokenHash: sha256(b.token), resetExpires: { $gt: new Date() } });
    if (!user) throw badRequest('This reset link is invalid or has expired', 'BAD_TOKEN');
    user.passwordHash = await hashPassword(b.password);
    user.resetTokenHash = undefined;
    user.resetExpires = undefined;
    await user.save();
    await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/verify-email',
  ah(async (req, res) => {
    const b = parse(z.object({ token: z.string().min(20) }), req.body);
    const user = await User.findOneAndUpdate(
      { emailVerifyTokenHash: sha256(b.token), emailVerifyExpires: { $gt: new Date() } },
      { $set: { emailVerified: true }, $unset: { emailVerifyTokenHash: 1, emailVerifyExpires: 1 } },
      { new: true },
    ).lean();
    if (!user) throw badRequest('This verification link is invalid or has expired', 'BAD_TOKEN');
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/resend-verification',
  requireAuth,
  authLimiter,
  ah(async (req, res) => {
    const u = await User.findById(uid(req), { emailVerified: 1, email: 1, emailCode: 1 }).lean<UserT>();
    if (!u || u.emailVerified) return res.json({ ok: true, verified: true });
    const wait = codeCooldown(u);
    if (wait > 0) return res.json({ ok: true, sent: true, email: maskEmail(u.email), resendIn: wait });
    const sent = await sendVerificationCode(uid(req));
    if (!sent) throw new AppError(503, 'MAIL_UNAVAILABLE', 'E-mail is temporarily unavailable. Please try again later.');
    res.json({ ok: true, sent: true, email: maskEmail(u.email), resendIn: Math.ceil(CODE_RESEND_COOLDOWN_MS / 1000) });
  }),
);

/** Signed-in users (e.g. registered while e-mail was paused) confirm their address with a code. */
authRouter.post(
  '/verify-email-code',
  requireAuth,
  authLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
    await confirmVerificationCode(uid(req), b.code);
    res.json({ ok: true });
  }),
);
