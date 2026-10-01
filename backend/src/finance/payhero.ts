import { env } from '../config/env';
import { createLogger } from '../lib/logger';

const log = createLogger('payhero');

/** PayHero is used when selected and configured (auth token + payment channel). */
export const payheroConfigured = () => !!env.PAYHERO_AUTH_TOKEN && !!env.PAYHERO_CHANNEL_ID;

export const payheroCallbackUrl = () =>
  `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/payments/payhero/${env.MPESA_CALLBACK_SECRET}/callback`;

function authHeader() {
  const t = env.PAYHERO_AUTH_TOKEN!.trim();
  return t.toLowerCase().startsWith('basic ') ? t : `Basic ${t}`;
}

/** 2547XXXXXXXX → 07XXXXXXXX (the format shown in PayHero's docs). */
const localPhone = (msisdn: string) => (msisdn.startsWith('254') ? `0${msisdn.slice(3)}` : msisdn);

export interface PayheroStkResult {
  reference: string;
  checkoutRequestId: string;
  status: string;
}

/** POST /api/v2/payments: initiates an M-Pesa STK push to the customer's phone. */
export async function payheroStkPush(p: { phone: string; amountKes: number; externalReference: string; customerName?: string }): Promise<PayheroStkResult> {
  const res = await fetch(`${env.PAYHERO_BASE_URL.replace(/\/$/, '')}/api/v2/payments`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.ceil(p.amountKes),
      phone_number: localPhone(p.phone),
      channel_id: Number(env.PAYHERO_CHANNEL_ID),
      provider: 'm-pesa',
      external_reference: p.externalReference,
      customer_name: p.customerName?.slice(0, 60),
      callback_url: payheroCallbackUrl(),
      ...(env.PAYHERO_CREDENTIAL_ID ? { credential_id: env.PAYHERO_CREDENTIAL_ID } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    status?: string;
    reference?: string;
    CheckoutRequestID?: string;
    error_message?: string;
    message?: string;
  };
  if (!res.ok || !j.success || !j.CheckoutRequestID) {
    log.warn(`STK push rejected (${res.status}): ${JSON.stringify(j).slice(0, 300)}`);
    throw new Error(j.error_message ?? j.message ?? `M-Pesa request failed (${res.status})`);
  }
  log.info(`STK push queued ${j.CheckoutRequestID} ref=${j.reference}`);
  return { reference: j.reference ?? '', checkoutRequestId: j.CheckoutRequestID, status: j.status ?? 'QUEUED' };
}

export interface PayheroStatus {
  status: string; // QUEUED | SUCCESS | FAILED | CANCELLED …
  success?: boolean;
  amount?: number;
  provider_reference?: string; // M-Pesa receipt, e.g. UJ1LQ89P83
  third_party_reference?: string;
  external_reference?: string;
  reference?: string;
  phone_number?: string;
  result_desc?: string;
  description?: string;
}

/**
 * GET /api/v2/transaction-status?reference=…: asks PayHero what happened to an STK push.
 * Used when the callback doesn't arrive (e.g. API_PUBLIC_URL isn't publicly reachable).
 */
export async function payheroStatus(reference: string): Promise<PayheroStatus> {
  const url = `${env.PAYHERO_BASE_URL.replace(/\/$/, '')}/api/v2/transaction-status?reference=${encodeURIComponent(reference)}`;
  const res = await fetch(url, { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as PayheroStatus & { error_message?: string };
  if (!res.ok) throw new Error(j.error_message ?? `PayHero status failed (${res.status})`);
  return j;
}

/** Body PayHero POSTs to callback_url once the customer pays, cancels or the prompt times out. */
export interface PayheroCallback {
  forward_url?: string;
  status?: boolean;
  response?: {
    Amount?: number;
    CheckoutRequestID?: string;
    ExternalReference?: string;
    MerchantRequestID?: string;
    MpesaReceiptNumber?: string;
    Phone?: string;
    ResultCode?: number | string;
    ResultDesc?: string;
    Status?: string;
  };
}
