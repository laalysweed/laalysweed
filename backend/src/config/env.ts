import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true'));

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default('http://localhost:4200'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: optionalStr, // defaults to APP_URL (+ its www / non-www twin)
  MONGO_URI: optionalStr,
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  COOKIE_SECURE: z.enum(['true', 'false', '']).optional(), // defaults to true when APP_URL is https
  OTC_SEED: z.string().default('dev-otc-seed'),
  BINANCE_ENABLED: bool(true),
  BINANCE_WS_URL: z.string().default('wss://stream.binance.com:9443/stream'),
  BINANCE_REST_URL: z.string().default('https://api.binance.com'),
  TICK_RETENTION_DAYS: z.coerce.number().default(0),
  SMTP_HOST: optionalStr,
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: optionalStr,
  SMTP_PASS: optionalStr,
  MAIL_FROM: z.string().default('Y2 Markets <no-reply@y2markets.site>'),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: optionalStr,
  MPESA_CONSUMER_SECRET: optionalStr,
  MPESA_SHORTCODE: z.string().default('174379'),
  MPESA_PASSKEY: z.string().default('bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'),
  MPESA_B2C_SHORTCODE: z.string().default('600000'),
  MPESA_B2C_INITIATOR: z.string().default('testapi'),
  MPESA_B2C_SECURITY_CREDENTIAL: optionalStr,
  MPESA_CALLBACK_SECRET: z.string().default('dev-callback-secret'),
  // Only for local demos: fakes successful STK pushes / B2C payouts. Never enable with real money.
  MPESA_SIMULATE: bool(false),
  // Which gateway sends M-Pesa STK pushes: PayHero (default) or Safaricom Daraja directly.
  MPESA_PROVIDER: z.enum(['payhero', 'daraja']).default('payhero'),
  PAYHERO_BASE_URL: z.string().default('https://backend.payhero.co.ke'),
  PAYHERO_AUTH_TOKEN: optionalStr, // the Basic auth token from the PayHero dashboard ("Basic xxxx" or just "xxxx")
  PAYHERO_CHANNEL_ID: optionalStr, // Payment Channels → My Payment Channels
  PAYHERO_CREDENTIAL_ID: optionalStr, // optional: use your own Daraja keys registered on PayHero
  KES_PER_USD: z.coerce.number().positive().default(129),
  SANDBOX_PAYMENTS: bool(false),
  // Deposit methods users may select (others are shown locked). e.g. "mpesa,usdt_trc20"
  DEPOSIT_METHODS: z.string().default('mpesa,crypto'), // crypto wallet addresses are set in Admin → Crypto wallets
  ADMIN_EMAIL: z.string().email().default('admin@y2markets.site'),
  ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
  UPLOAD_DIR: z.string().default('uploads'),
  REQUIRE_KYC_FOR_WITHDRAWAL: bool(false),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;
const appOrigin = raw.APP_URL.replace(/\/$/, '');
const twin = appOrigin.includes('://www.') ? appOrigin.replace('://www.', '://') : appOrigin.replace('://', '://www.');
const isProdEnv = raw.NODE_ENV === 'production' || !!process.env['RENDER'];
export const env = {
  ...raw,
  CORS_ORIGINS: raw.CORS_ORIGINS ?? (appOrigin.startsWith('http://localhost') ? appOrigin : `${appOrigin},${twin}`),
  COOKIE_SECURE: raw.COOKIE_SECURE !== undefined && raw.COOKIE_SECURE !== ''
    ? raw.COOKIE_SECURE === 'true'
    : (isProdEnv || appOrigin.startsWith('https://')),
};
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProd) {
  const weak = (['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'OTC_SEED', 'MPESA_CALLBACK_SECRET'] as const).filter(
    (k) => env[k].startsWith('dev-') || env[k].startsWith('change-me') || env[k].length < 24,
  );
  if (weak.length) throw new Error(`Refusing to start in production with weak secrets: ${weak.join(', ')}`);
  if (!env.MONGO_URI) throw new Error('MONGO_URI is required in production');
  if (env.SANDBOX_PAYMENTS) console.warn('[env] SANDBOX_PAYMENTS=true in production: simulated card payments are ENABLED');
  if (env.MPESA_SIMULATE) console.warn('[env] MPESA_SIMULATE=true in production: M-Pesa is simulated');
}
