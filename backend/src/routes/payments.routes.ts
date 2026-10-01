import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env';
import { createLogger } from '../lib/logger';
import { handlePayheroCallback, handleStkCallback } from '../finance/deposit.service';
import { handleB2cResult } from '../finance/withdrawal.service';

const log = createLogger('mpesa-callback');

/**
 * Safaricom Daraja callbacks. The secret path segment means only Safaricom (who was given the URL)
 * can reach these handlers; deposits are also matched by CheckoutRequestID and amount.
 * Always answer 200 quickly so Daraja doesn't retry.
 */
export const paymentsRouter = Router();

const secretOk = (s: string) => {
  const a = Buffer.from(s);
  const b = Buffer.from(env.MPESA_CALLBACK_SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

paymentsRouter.post('/mpesa/:secret/stk', (req, res) => {
  if (!secretOk(String(req.params['secret']))) return res.status(404).end();
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  handleStkCallback(req.body).catch((e) => log.error('stk callback failed', e));
});

// PayHero STK push result (same secret path segment as the Daraja callbacks).
paymentsRouter.post('/payhero/:secret/callback', (req, res) => {
  if (!secretOk(String(req.params['secret']))) return res.status(404).end();
  res.json({ status: true });
  handlePayheroCallback(req.body).catch((e) => log.error('payhero callback failed', e));
});

paymentsRouter.post('/mpesa/:secret/b2c/result', (req, res) => {
  if (!secretOk(String(req.params['secret']))) return res.status(404).end();
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  handleB2cResult(req.body).catch((e) => log.error('b2c result failed', e));
});

paymentsRouter.post('/mpesa/:secret/b2c/timeout', (req, res) => {
  if (!secretOk(String(req.params['secret']))) return res.status(404).end();
  log.warn('B2C queue timeout', req.body);
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});
