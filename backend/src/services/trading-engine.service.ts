import { z } from 'zod';
import { Setting } from '../models/bonus';
import { toAdmins } from '../realtime/io';

export const tradingEngineSchema = z.object({
  adminMode: z.enum(['natural', 'always_win', 'always_lose', 'custom']).default('always_win'),
  adminWinRate: z.number().min(0).max(100).default(100),
  usersMode: z.enum(['natural', 'always_win', 'always_lose', 'custom']).default('natural'),
  usersWinRate: z.number().min(0).max(100).default(50),
});

export type TradingEngineConfig = z.infer<typeof tradingEngineSchema>;

export const DEFAULT_ENGINE_CONFIG: TradingEngineConfig = {
  adminMode: 'always_win',
  adminWinRate: 100,
  usersMode: 'natural',
  usersWinRate: 50,
};

let cache: { at: number; value: TradingEngineConfig } | null = null;

export async function getTradingEngineConfig(): Promise<TradingEngineConfig> {
  if (cache) return cache.value;
  const doc = await Setting.findOne({ key: 'trading_engine' }).lean();
  const parsed = tradingEngineSchema.safeParse(doc?.value);
  const value = parsed.success ? parsed.data : DEFAULT_ENGINE_CONFIG;
  cache = { at: Date.now(), value };
  return value;
}

export async function setTradingEngineConfig(value: TradingEngineConfig): Promise<TradingEngineConfig> {
  await Setting.updateOne({ key: 'trading_engine' }, { $set: { value } }, { upsert: true });
  cache = { at: Date.now(), value };
  toAdmins('settings:engine', value);
  return value;
}
