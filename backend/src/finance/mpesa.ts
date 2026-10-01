import { env } from '../config/env';
import { createLogger } from '../lib/logger';
import { randomToken } from '../lib/crypto';

const log = createLogger('mpesa');
const BASE = env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

/** Simulation happens ONLY when MPESA_SIMULATE=true (local demos). Missing keys never fake a payment. */
export const mpesaSimulated = () => env.MPESA_SIMULATE;
export const darajaConfigured = () => !!env.MPESA_CONSUMER_KEY && !!env.MPESA_CONSUMER_SECRET;

export const callbackUrl = (kind: 'stk' | 'b2c/result' | 'b2c/timeout') =>
  `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/payments/mpesa/${env.MPESA_CALLBACK_SECRET}/${kind}`;

/** Accepts 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX. Returns 2547XXXXXXXX or null. */
export function normalizeKePhone(input: string): string | null {
  const d = input.replace(/[^\d]/g, '');
  let n: string | null = null;
  if (/^0[17]\d{8}$/.test(d)) n = `254${d.slice(1)}`;
  else if (/^254[17]\d{8}$/.test(d)) n = d;
  else if (/^[17]\d{8}$/.test(d)) n = `254${d}`;
  return n;
}

/** Daraja timestamp: yyyyMMddHHmmss in East Africa Time. */
function timestamp() {
  const d = new Date(Date.now() + 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 30_000) return tokenCache.token;
  const auth = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: string };
  tokenCache = { token: j.access_token, exp: Date.now() + Number(j.expires_in) * 1000 };
  return j.access_token;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as T & { errorMessage?: string };
  if (!res.ok) throw new Error(j.errorMessage ?? `Daraja ${path} failed (${res.status})`);
  return j;
}

export async function stkPush(p: { phone: string; amountKes: number; reference: string; description: string }) {
  if (mpesaSimulated()) {
    return { merchantRequestId: `SIM-${randomToken(6)}`, checkoutRequestId: `ws_CO_SIM_${randomToken(10)}`, simulated: true };
  }
  if (!darajaConfigured()) throw new Error('M-Pesa is not configured (Daraja keys missing)');
  const ts = timestamp();
  const password = Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${ts}`).toString('base64');
  const r = await post<{ MerchantRequestID: string; CheckoutRequestID: string; ResponseCode: string; CustomerMessage: string }>(
    '/mpesa/stkpush/v1/processrequest',
    {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: p.amountKes,
      PartyA: p.phone,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: p.phone,
      CallBackURL: callbackUrl('stk'),
      AccountReference: p.reference.slice(0, 12),
      TransactionDesc: p.description.slice(0, 13),
    },
  );
  if (r.ResponseCode !== '0') throw new Error(r.CustomerMessage || 'STK push rejected');
  log.info(`STK push sent ${r.CheckoutRequestID}`);
  return { merchantRequestId: r.MerchantRequestID, checkoutRequestId: r.CheckoutRequestID, simulated: false };
}

export async function stkQuery(checkoutRequestId: string) {
  const ts = timestamp();
  const password = Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${ts}`).toString('base64');
  return post<{ ResultCode?: string; ResultDesc?: string }>('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: ts,
    CheckoutRequestID: checkoutRequestId,
  });
}

export async function b2cPayout(p: { phone: string; amountKes: number; originatorConversationId: string; remarks: string }) {
  if (mpesaSimulated()) return { conversationId: `SIM-${randomToken(6)}`, originatorConversationId: p.originatorConversationId, simulated: true, manual: false };
  // No B2C credentials: never fake a payout. The finance team pays manually and marks it paid.
  if (!darajaConfigured() || !env.MPESA_B2C_SECURITY_CREDENTIAL) return { conversationId: '', originatorConversationId: p.originatorConversationId, simulated: false, manual: true };
  const r = await post<{ ConversationID: string; OriginatorConversationID: string; ResponseCode: string; ResponseDescription: string }>(
    '/mpesa/b2c/v3/paymentrequest',
    {
      OriginatorConversationID: p.originatorConversationId,
      InitiatorName: env.MPESA_B2C_INITIATOR,
      SecurityCredential: env.MPESA_B2C_SECURITY_CREDENTIAL,
      CommandID: 'BusinessPayment',
      Amount: p.amountKes,
      PartyA: env.MPESA_B2C_SHORTCODE,
      PartyB: p.phone,
      Remarks: p.remarks.slice(0, 100),
      QueueTimeOutURL: callbackUrl('b2c/timeout'),
      ResultURL: callbackUrl('b2c/result'),
      Occasion: 'Withdrawal',
    },
  );
  if (r.ResponseCode !== '0') throw new Error(r.ResponseDescription || 'B2C request rejected');
  return { conversationId: r.ConversationID, originatorConversationId: r.OriginatorConversationID, simulated: false, manual: false };
}
