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

/** `body` must be trusted HTML (callers pass fixed copy, never user input). */
export async function sendMail(to: string, subject: string, title: string, body: string, cta?: { label: string; url: string }) {
  const html = layout(title, body, cta);
  if (!transport) {
    log.info(`(console mail) to=${to} subject="${subject}"${cta ? ` link=${cta.url}` : ''}`);
    return;
  }
  try {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, html });
  } catch (e) {
    log.error(`failed to send mail to ${to}`, e);
  }
}
