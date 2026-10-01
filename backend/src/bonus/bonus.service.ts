import crypto from 'node:crypto';
import { ClientSession, Types } from 'mongoose';
import { UserBonus, UserBonusT, TradersBoxRoll } from '../models/bonus';
import { Account, AccountT } from '../models/account';
import { DepositT, Deposit } from '../models/finance';
import { User } from '../models/user';
import { BonusConfig, getBonusConfig } from '../services/settings.service';
import { emitAccounts, postEntry, withTxn } from '../services/ledger.service';
import { notFound } from '../lib/errors';
import { fmtUsd, pctOf } from '../lib/money';
import { toUser } from '../realtime/io';

export type OfferKey = 'first50' | 'welcome100';

/** Full human-readable terms shown BEFORE the user opts in. Generated from live config so they never drift. */
export function offerTerms(offer: OfferKey, cfg: BonusConfig): { title: string; summary: string; terms: string[] } {
  const o = cfg[offer];
  const title = offer === 'first50' ? `${o.pct}% bonus on your first deposit` : `Welcome bonus: ${o.pct}% on your top-up`;
  return {
    title,
    summary: `Get ${o.pct}% of your deposit as bonus funds (up to ${fmtUsd(o.maxBonus)}). Minimum deposit ${fmtUsd(o.minDeposit)}.`,
    terms: [
      `Bonus = ${o.pct}% of the deposit amount, capped at ${fmtUsd(o.maxBonus)}. Minimum qualifying deposit: ${fmtUsd(o.minDeposit)}.`,
      offer === 'first50' ? 'Only your first ever deposit qualifies.' : 'Available once per account, on any single deposit meeting the minimum.',
      'Bonus funds are held in a separate bonus balance. Your deposited money stays in your cash balance and remains withdrawable at any time.',
      `To convert bonus funds to cash, trade a total volume (turnover) of ${o.turnoverMultiplier}× the bonus amount on your REAL account. Progress is shown live in Finance → Bonuses.`,
      'When you place a trade, cash is used first; bonus funds are used only when cash is insufficient. Returns go back to the bucket that funded the stake.',
      'You can cancel the bonus at any time. Cancelling removes the remaining bonus balance (including bonus funds staked in still-open trades); your cash balance and cash profits are never affected.',
      'Only one bonus can be active at a time. Demo and tournament trades do not count toward turnover.',
      `Terms version ${cfg.termsVersion}.`,
    ],
  };
}

export function tradersBoxTerms(cfg: BonusConfig) {
  const total = cfg.tradersBox.rewards.reduce((s, r) => s + r.weight, 0);
  return {
    minDeposit: cfg.tradersBox.minDeposit,
    odds: cfg.tradersBox.rewards.map((r) => ({ label: r.label, amount: r.amount, probability: r.weight / total })),
    expectedValue: Math.round(cfg.tradersBox.rewards.reduce((s, r) => s + (r.amount * r.weight) / total, 0)),
    terms: [
      `Opens once, on your first deposit of ${fmtUsd(cfg.tradersBox.minDeposit)} or more, if you opt in.`,
      'The reward is drawn on our server with a cryptographically secure random number generator (crypto.randomInt) at the moment your deposit completes.',
      'Rewards are paid to your cash balance with no turnover requirement.',
      'Every draw is recorded (roll value and odds) and visible in your history.',
    ],
  };
}

export const activeBonus = (userId: Types.ObjectId | string, session?: ClientSession) =>
  UserBonus.findOne({ userId, status: 'active' }).session(session ?? null);

/**
 * Grants the opted-in bonus for a completed deposit (inside the deposit transaction).
 * Returns silently (no bonus) if the deposit doesn't qualify.
 */
export async function grantDepositBonus(session: ClientSession, dep: DepositT, cfg: BonusConfig, isFirstDeposit: boolean) {
  const offer = dep.bonusOffer as OfferKey | null;
  if (!offer) return null;
  const o = cfg[offer];
  if (!o.enabled || dep.amount < o.minDeposit) return null;
  if (offer === 'first50' && !isFirstDeposit) return null;
  if (await UserBonus.exists({ userId: dep.userId, status: 'active' }).session(session)) return null;
  if (offer === 'welcome100' && (await UserBonus.exists({ userId: dep.userId, offer: 'welcome100' }).session(session))) return null;

  const amount = Math.min(o.maxBonus, pctOf(dep.amount, o.pct));
  if (amount <= 0) return null;
  const [bonus] = await UserBonus.create(
    [
      {
        userId: dep.userId,
        accountId: dep.accountId,
        offer,
        amount,
        turnoverRequired: amount * o.turnoverMultiplier,
        depositId: dep._id,
        termsVersion: dep.bonusTermsVersion ?? cfg.termsVersion,
        acceptedAt: new Date(),
      },
    ],
    { session },
  );
  await postEntry(session, { accountId: dep.accountId, type: 'bonus_credit', bucket: 'bonus', amount, refKind: 'bonus', refId: bonus!._id });
  return bonus!;
}

/** Adds REAL-account trade volume to the active bonus; converts bonus to cash when turnover completes. */
export async function applyTurnover(session: ClientSession, userId: Types.ObjectId, accountId: Types.ObjectId, amount: number) {
  const b = await UserBonus.findOneAndUpdate(
    { userId, status: 'active', accountId },
    { $inc: { turnoverDone: amount } },
    { new: true, session },
  );
  if (!b || b.turnoverDone < b.turnoverRequired) return b;
  const acc = await Account.findById(accountId).session(session).lean<AccountT>();
  const convert = acc?.bonusBalance ?? 0;
  if (convert > 0) {
    await postEntry(session, { accountId, type: 'bonus_convert', bucket: 'bonus', amount: -convert, refKind: 'bonus', refId: b._id });
    await postEntry(session, { accountId, type: 'bonus_convert', bucket: 'cash', amount: convert, refKind: 'bonus', refId: b._id });
  }
  b.status = 'completed';
  b.completedAt = new Date();
  b.convertedAmount = convert;
  await b.save({ session });
  return b;
}

export async function cancelBonus(userId: string, bonusId: string) {
  const result = await withTxn(async (session) => {
    const b = await UserBonus.findOne({ _id: bonusId, userId, status: 'active' }).session(session);
    if (!b) throw notFound('No active bonus with that id');
    const acc = await Account.findById(b.accountId).session(session).lean<AccountT>();
    const forfeit = acc?.bonusBalance ?? 0;
    if (forfeit > 0)
      await postEntry(session, { accountId: b.accountId, type: 'bonus_cancel', bucket: 'bonus', amount: -forfeit, refKind: 'bonus', refId: b._id });
    b.status = 'cancelled';
    b.cancelledAt = new Date();
    b.forfeitedAmount = forfeit;
    await b.save({ session });
    return b.toObject();
  });
  await emitAccounts(userId);
  toUser(userId, 'bonus:update', publicBonus(result));
  return result;
}

/** Trader's Box draw. crypto.randomInt is uniform and unpredictable; the roll is stored for audit. */
export async function rollTradersBox(session: ClientSession, dep: DepositT, cfg: BonusConfig, isFirstDeposit: boolean) {
  if (!dep.tradersBox || !cfg.tradersBox.enabled || !isFirstDeposit || dep.amount < cfg.tradersBox.minDeposit) return null;
  const rewards = cfg.tradersBox.rewards;
  const total = rewards.reduce((s, r) => s + r.weight, 0);
  const roll = crypto.randomInt(0, total);
  let acc = 0;
  const reward = rewards.find((r) => (acc += r.weight) > roll)!;
  const [rec] = await TradersBoxRoll.create(
    [{ userId: dep.userId, depositId: dep._id, roll, weightTotal: total, rewardLabel: reward.label, rewardAmount: reward.amount }],
    { session },
  );
  if (reward.amount > 0)
    await postEntry(session, { accountId: dep.accountId, type: 'box_reward', bucket: 'cash', amount: reward.amount, refKind: 'box', refId: rec!._id });
  return { label: reward.label, amount: reward.amount, roll, weightTotal: total };
}

/** Pays the referrer a % of each completed deposit of the people they invited. */
export async function payReferralCommission(session: ClientSession, dep: DepositT, cfg: BonusConfig) {
  if (cfg.referral.depositPct <= 0) return null;
  const u = await User.findById(dep.userId, { referredBy: 1 }).session(session).lean();
  if (!u?.referredBy) return null;
  const refAcc = await Account.findOne({ userId: u.referredBy, type: 'real' }).session(session).lean<AccountT>();
  if (!refAcc) return null;
  const amount = pctOf(dep.amount, cfg.referral.depositPct);
  if (amount <= 0) return null;
  await postEntry(session, { accountId: refAcc._id, type: 'referral_commission', bucket: 'cash', amount, refKind: 'deposit', refId: dep._id });
  return { referrerId: String(u.referredBy), amount };
}

export async function isFirstCompletedDeposit(session: ClientSession, userId: Types.ObjectId, depositId: Types.ObjectId) {
  return !(await Deposit.exists({ userId, status: 'completed', _id: { $ne: depositId } }).session(session));
}

export async function bonusOverview(userId: string) {
  const cfg = await getBonusConfig();
  const [mine, rolls, anyDeposit, welcomeUsed] = await Promise.all([
    UserBonus.find({ userId }).sort({ createdAt: -1 }).lean<UserBonusT[]>(),
    TradersBoxRoll.find({ userId }).sort({ createdAt: -1 }).lean(),
    Deposit.exists({ userId, status: 'completed' }),
    UserBonus.exists({ userId, offer: 'welcome100' }),
  ]);
  const hasActive = mine.some((b) => b.status === 'active');
  return {
    offers: (['first50', 'welcome100'] as const)
      .filter((k) => cfg[k].enabled)
      .map((k) => ({
        key: k,
        ...offerTerms(k, cfg),
        pct: cfg[k].pct,
        minDeposit: cfg[k].minDeposit,
        maxBonus: cfg[k].maxBonus,
        turnoverMultiplier: cfg[k].turnoverMultiplier,
        eligible: !hasActive && (k === 'first50' ? !anyDeposit : !welcomeUsed),
      })),
    termsVersion: cfg.termsVersion,
    tradersBox: { ...tradersBoxTerms(cfg), enabled: cfg.tradersBox.enabled, eligible: !anyDeposit },
    bonuses: mine.map(publicBonus),
    rolls: rolls.map((r) => ({ id: String(r._id), label: r.rewardLabel, amount: r.rewardAmount, roll: r.roll, weightTotal: r.weightTotal, createdAt: r.createdAt })),
  };
}

export function publicBonus(b: UserBonusT) {
  return {
    id: String(b._id),
    offer: b.offer,
    amount: b.amount,
    turnoverRequired: b.turnoverRequired,
    turnoverDone: Math.min(b.turnoverDone, b.turnoverRequired),
    status: b.status,
    termsVersion: b.termsVersion,
    createdAt: (b as unknown as { createdAt: Date }).createdAt,
    completedAt: b.completedAt ?? null,
    cancelledAt: b.cancelledAt ?? null,
    convertedAmount: b.convertedAmount ?? null,
    forfeitedAmount: b.forfeitedAmount ?? null,
  };
}
