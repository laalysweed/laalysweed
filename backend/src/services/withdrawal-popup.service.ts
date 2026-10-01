import { z } from 'zod';
import { Setting } from '../models/bonus';
import { User, UserT } from '../models/user';

export const withdrawalPopupSchema = z.object({
  enabled: z.boolean().default(false),
  title: z.string().trim().max(120).default('Important Withdrawal Notice'),
  message: z.string().trim().max(2000).default(''),
  type: z.enum(['info', 'warning', 'error', 'success']).default('info'),
  blocking: z.boolean().default(false),
  buttonText: z.string().trim().max(50).default('Understood'),
  buttonAction: z.enum(['close', 'support', 'kyc', 'deposit']).default('close'),
});

export type WithdrawalPopupConfig = z.infer<typeof withdrawalPopupSchema>;

export const DEFAULT_GLOBAL_POPUP: WithdrawalPopupConfig = {
  enabled: false,
  title: 'Important Withdrawal Notice',
  message: 'Please ensure your identity is verified and payment account details match your registered name.',
  type: 'info',
  blocking: false,
  buttonText: 'Understood',
  buttonAction: 'close',
};

let cache: { at: number; value: WithdrawalPopupConfig } | null = null;

export async function getGlobalWithdrawalPopup(): Promise<WithdrawalPopupConfig> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const doc = await Setting.findOne({ key: 'withdrawal_popup' }).lean();
  const parsed = withdrawalPopupSchema.safeParse(doc?.value);
  const value = parsed.success ? parsed.data : DEFAULT_GLOBAL_POPUP;
  cache = { at: Date.now(), value };
  return value;
}

export async function setGlobalWithdrawalPopup(value: WithdrawalPopupConfig): Promise<void> {
  await Setting.updateOne({ key: 'withdrawal_popup' }, { $set: { value } }, { upsert: true });
  cache = null;
}

export async function getEffectiveWithdrawalPopup(userId: string): Promise<WithdrawalPopupConfig | null> {
  const user = await User.findById(userId, { withdrawalPopup: 1 }).lean<UserT>();
  if (user?.withdrawalPopup?.enabled) {
    const custom = withdrawalPopupSchema.safeParse(user.withdrawalPopup);
    if (custom.success && custom.data.enabled) {
      return custom.data;
    }
  }

  const global = await getGlobalWithdrawalPopup();
  if (global.enabled) {
    return global;
  }

  return null;
}
