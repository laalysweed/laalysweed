import { z } from 'zod';
import QRCode from 'qrcode';
import { Setting } from '../models/bonus';
import { marketHub } from '../market/market-hub';

/**
 * Company deposit wallets, edited by admins in the admin panel (stored in the database,
 * not in .env). Only enabled coins with an address are offered to users.
 */
export const cryptoWalletSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]{2,20}$/),
  coin: z.string().min(2).max(10),
  name: z.string().min(2).max(40),
  network: z.string().min(2).max(40),
  address: z.string().trim().max(120),
  priceSymbol: z.string().max(20).optional(), // live price feed used to show the approximate coin amount
  popular: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export const cryptoWalletsSchema = z.array(cryptoWalletSchema).max(20);
export type CryptoWallet = z.infer<typeof cryptoWalletSchema>;

export const DEFAULT_CRYPTO_WALLETS: CryptoWallet[] = [
  { code: 'usdt_trc20', coin: 'USDT', name: 'Tether USD', network: 'TRC-20 (Tron)', address: '', popular: true, enabled: true },
  { code: 'btc', coin: 'BTC', name: 'Bitcoin', network: 'Bitcoin', address: '', priceSymbol: 'BTCUSDT', popular: false, enabled: true },
  { code: 'eth', coin: 'ETH', name: 'Ethereum', network: 'ERC-20 (Ethereum)', address: '', priceSymbol: 'ETHUSDT', popular: false, enabled: true },
  { code: 'bnb', coin: 'BNB', name: 'BNB', network: 'BEP-20 (BSC)', address: '', priceSymbol: 'BNBUSDT', popular: false, enabled: true },
  { code: 'sol', coin: 'SOL', name: 'Solana', network: 'Solana', address: '', priceSymbol: 'SOLUSDT', popular: false, enabled: true },
];

let cache: { at: number; value: CryptoWallet[] } | null = null;

export async function getCryptoWallets(): Promise<CryptoWallet[]> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const doc = await Setting.findOne({ key: 'crypto_wallets' }).lean();
  const parsed = cryptoWalletsSchema.safeParse(doc?.value);
  const value = parsed.success ? parsed.data : DEFAULT_CRYPTO_WALLETS;
  cache = { at: Date.now(), value };
  return value;
}

export async function setCryptoWallets(value: CryptoWallet[]) {
  await Setting.updateOne({ key: 'crypto_wallets' }, { $set: { value } }, { upsert: true });
  cache = null;
}

/** Wallets users can deposit to right now. */
export async function activeWallets() {
  return (await getCryptoWallets()).filter((w) => w.enabled && w.address.length >= 20);
}

/** Approximate coin amount for a USD deposit (stablecoins 1:1, others from the live Binance price). */
export function coinAmount(w: CryptoWallet, usdCents: number): number | null {
  if (!w.priceSymbol) return Math.round(usdCents) / 100;
  const p = marketHub.latest(w.priceSymbol)?.price;
  if (!p) return null;
  return Number((usdCents / 100 / p).toPrecision(6));
}

export const addressQr = (address: string) => QRCode.toDataURL(address, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
