import { Schema, model, InferSchemaType, Types } from 'mongoose';

export const ACCOUNT_TYPES = ['demo', 'real', 'tournament'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

const accountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    tournamentId: { type: Schema.Types.ObjectId, ref: 'Tournament', default: null },
    currency: { type: String, default: 'USD' },
    /** Withdrawable funds, integer cents. */
    balance: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    /** Bonus funds (not withdrawable until turnover completes), integer cents. */
    bonusBalance: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  },
  { timestamps: true },
);
accountSchema.index({ userId: 1, type: 1, tournamentId: 1 }, { unique: true });

export type AccountT = InferSchemaType<typeof accountSchema> & { _id: Types.ObjectId };
export const Account = model('Account', accountSchema);

export function publicAccount(a: AccountT) {
  return {
    id: String(a._id),
    type: a.type,
    tournamentId: a.tournamentId ? String(a.tournamentId) : null,
    currency: a.currency,
    balance: a.balance,
    bonusBalance: a.bonusBalance,
  };
}

export const LEDGER_TYPES = [
  'demo_credit',
  'demo_reset',
  'deposit',
  'withdrawal_hold',
  'withdrawal_reversal',
  'trade_open',
  'trade_payout',
  'trade_refund',
  'cfd_margin',
  'cfd_close',
  'bonus_credit',
  'bonus_cancel',
  'bonus_convert',
  'box_reward',
  'referral_commission',
  'tournament_fee',
  'tournament_start',
  'tournament_prize',
  'admin_adjust',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

const ledgerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    accountType: { type: String, enum: ACCOUNT_TYPES, required: true },
    type: { type: String, enum: LEDGER_TYPES, required: true, index: true },
    bucket: { type: String, enum: ['cash', 'bonus'], required: true },
    amount: { type: Number, required: true, validate: Number.isSafeInteger }, // signed cents
    balanceAfter: { type: Number, required: true },
    refKind: { type: String },
    refId: { type: Schema.Types.ObjectId },
    note: { type: String },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
ledgerSchema.index({ userId: 1, createdAt: -1 });
ledgerSchema.index({ refKind: 1, refId: 1 });

export type LedgerT = InferSchemaType<typeof ledgerSchema> & { _id: Types.ObjectId };
export const LedgerEntry = model('LedgerEntry', ledgerSchema);
