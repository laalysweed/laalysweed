import { z } from 'zod';
import { Setting } from '../models/bonus';

export const bonusConfigSchema = z.object({
  termsVersion: z.string().min(1),
  first50: z.object({
    enabled: z.boolean(),
    pct: z.number().int().min(1).max(200),
    minDeposit: z.number().int().min(0),
    maxBonus: z.number().int().min(0),
    turnoverMultiplier: z.number().int().min(1).max(100),
  }),
  welcome100: z.object({
    enabled: z.boolean(),
    pct: z.number().int().min(1).max(200),
    minDeposit: z.number().int().min(0),
    maxBonus: z.number().int().min(0),
    turnoverMultiplier: z.number().int().min(1).max(100),
  }),
  tradersBox: z.object({
    enabled: z.boolean(),
    minDeposit: z.number().int().min(0),
    rewards: z.array(z.object({ label: z.string(), amount: z.number().int().min(0), weight: z.number().int().min(1) })).min(1),
  }),
  referral: z.object({ depositPct: z.number().min(0).max(50) }),
  demoBalance: z.number().int().min(0),
  limits: z.object({
    minDeposit: z.number().int().min(1), // cents: 1 = $0.01
    maxDeposit: z.number().int().min(1).default(1_000_000),
    minWithdrawal: z.number().int().min(100),
  }),
});
export type BonusConfig = z.infer<typeof bonusConfigSchema>;

export const DEFAULT_BONUS_CONFIG: BonusConfig = {
  termsVersion: '2026-09-01',
  first50: { enabled: true, pct: 50, minDeposit: 1000, maxBonus: 50_000, turnoverMultiplier: 20 },
  welcome100: { enabled: true, pct: 100, minDeposit: 10_000, maxBonus: 100_000, turnoverMultiplier: 30 },
  tradersBox: {
    enabled: true,
    minDeposit: 2500,
    rewards: [
      { label: '$1 cash', amount: 100, weight: 400 },
      { label: '$2 cash', amount: 200, weight: 300 },
      { label: '$5 cash', amount: 500, weight: 180 },
      { label: '$10 cash', amount: 1000, weight: 80 },
      { label: '$25 cash', amount: 2500, weight: 30 },
      { label: '$100 cash', amount: 10_000, weight: 10 },
    ],
  },
  referral: { depositPct: 5 },
  demoBalance: 1_000_000,
  limits: { minDeposit: 1000, maxDeposit: 1_000_000, minWithdrawal: 1000 },
};

let cache: { at: number; value: BonusConfig } | null = null;

export async function getBonusConfig(): Promise<BonusConfig> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const doc = await Setting.findOne({ key: 'bonuses' }).lean();
  const parsed = bonusConfigSchema.safeParse(doc?.value);
  const value = parsed.success ? parsed.data : DEFAULT_BONUS_CONFIG;
  cache = { at: Date.now(), value };
  return value;
}

export async function setBonusConfig(value: BonusConfig) {
  await Setting.updateOne({ key: 'bonuses' }, { $set: { value } }, { upsert: true });
  cache = null;
}
