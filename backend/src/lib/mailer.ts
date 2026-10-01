import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('mail');
const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function layout(title: string, body: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#0F1420;font-family:Inter,Arial,sans-serif;color:#E6EAF2">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px">
    <div style="font-weight:800;font-size:22px;margin-bottom:24px"><span style="color:#38BDF8">Y2</span> Markets</div>
    <div style="background:#161C2A;border-radius:12px;padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
      <div style="color:#8A93A6;line-height:1.6">${body}</div>
      ${cta ? `<a href="${esc(cta.url)}" style="display:inline-block;margin-top:20px;padding:12px 22px;border-radius:12px;background:linear-gradient(90deg,#2DD4BF,#38BDF8);color:#0F1420;font-weight:700;text-decoration:none">${esc(cta.label)}</a>` : ''}
    </div>
    <p style="color:#5b6477;font-size:12px;margin-top:24px">Trading involves significant risk of loss. Y2 Markets · y2markets.site</p>
  </div></body></html>`;
}

/** "Y2 Markets <no-reply@y2markets.site>" → { name, email } */
function parseFrom(from: string) {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2]! } : { email: from.trim() };
}

/** POST https://api.brevo.com/v3/smtp/email (transactional e-mail over HTTPS). */
async function sendViaBrevo(to: string, subject: string, html: string) {
  const res = await fetch(`${env.BREVO_API_URL}/v3/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY!, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: parseFrom(env.MAIL_FROM), to: [{ email: to }], subject, htmlContent: html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
}

/* ---------- sending capacity (Brevo free plan = limited daily credits) ---------- */

let creditCache: { at: number; ok: boolean } | null = null;
let exhaustedUntil = 0;

/** True when a real e-mail can be delivered right now (provider configured and credits left). */
export async function mailCanSend(): Promise<boolean> {
  if (!env.BREVO_API_KEY) return !!transport;
  if (Date.now() < exhaustedUntil) return false;
  if (creditCache && Date.now() - creditCache.at < 2 * 60_000) return creditCache.ok;
  try {
    const res = await fetch(`${env.BREVO_API_URL}/v3/account`, {
      headers: { 'api-key': env.BREVO_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { plan?: { type?: string; credits?: number; creditsType?: string }[] };
    // Send credits live on the plan entries; an unlimited/paid plan may not report a number.
    const counted = (j.plan ?? []).filter((p) => typeof p.credits === 'number' && (p.creditsType === 'sendLimit' || p.type === 'free'));
    const ok = counted.length ? counted.some((p) => (p.credits ?? 0) > 0) : true;
    creditCache = { at: Date.now(), ok };
    if (!ok) log.warn('Brevo credits exhausted: e-mail verification is paused until they are restored');
    return ok;
  } catch (e) {
    // Can't tell; let the actual send decide.
    log.warn(`Brevo credit check failed: ${(e as Error).message}`);
    return true;
  }
}

/** `body` must be trusted HTML (callers pass fixed copy, never user input). Resolves true when delivered to the provider. */
export async function sendMail(to: string, subject: string, title: string, body: string, cta?: { label: string; url: string }): Promise<boolean> {
  const html = layout(title, body, cta);
  if (!env.BREVO_API_KEY && !transport) {
    log.info(`(console mail) to=${to} subject="${subject}"${cta ? ` link=${cta.url}` : ''}`);
    return false;
  }
  try {
    if (env.BREVO_API_KEY) await sendViaBrevo(to, subject, html);
    else await transport!.sendMail({ from: env.MAIL_FROM, to, subject, html });
    return true;
  } catch (e) {
    const msg = (e as Error).message;
    // 402 / "not enough credits": stop trying for a while so users aren't blocked by a dead mailbox.
    if (/\b402\b|credit/i.test(msg)) {
      exhaustedUntil = Date.now() + 10 * 60_000;
      creditCache = { at: Date.now(), ok: false };
    }
    log.error(`failed to send mail to ${to}`, e);
    return false;
  }
}
