import { Schema, model, InferSchemaType, Types } from 'mongoose';
import { ACCOUNT_TYPES } from './account';

const tradeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    accountType: { type: String, enum: ACCOUNT_TYPES, required: true },
    symbol: { type: String, required: true, index: true },
    direction: { type: String, enum: ['up', 'down'], required: true },
    amount: { type: Number, required: true }, // cents
    fromCash: { type: Number, required: true },
    fromBonus: { type: Number, required: true },
    payoutPct: { type: Number, required: true },
    openPrice: { type: Number, required: true },
    openTickId: { type: Schema.Types.ObjectId, required: true },
    openedAt: { type: Date, required: true },
    durationSec: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['open', 'won', 'lost', 'draw'], default: 'open' },
    closePrice: Number,
    closeTickId: Schema.Types.ObjectId,
    closeTickTs: Date,
    closedAt: Date,
    payout: { type: Number, default: 0 }, // total credited back on close (cents)
    profit: { type: Number, default: 0 }, // payout - amount (cents, signed)
    idempotencyKey: { type: String, required: true },
    source: { type: String, enum: ['manual', 'pending', 'copy', 'ai'], default: 'manual' },
    copiedFrom: { type: Schema.Types.ObjectId, ref: 'Trade' },
  },
  { timestamps: true },
);
tradeSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
tradeSchema.index({ status: 1, expiresAt: 1 });
tradeSchema.index({ accountId: 1, status: 1, openedAt: -1 });

export type TradeT = InferSchemaType<typeof tradeSchema> & { _id: Types.ObjectId };
export const Trade = model('Trade', tradeSchema);

export function publicTrade(t: TradeT) {
  return {
    id: String(t._id),
    accountId: String(t.accountId),
    accountType: t.accountType,
    symbol: t.symbol,
    direction: t.direction,
    amount: t.amount,
    payoutPct: t.payoutPct,
    openPrice: t.openPrice,
    openedAt: t.openedAt,
    durationSec: t.durationSec,
    expiresAt: t.expiresAt,
    status: t.status,
    closePrice: t.closePrice ?? null,
    closedAt: t.closedAt ?? null,
    payout: t.payout,
    profit: t.profit,
    source: t.source,
    openTickId: String(t.openTickId),
    closeTickId: t.closeTickId ? String(t.closeTickId) : null,
  };
}

const pendingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    symbol: { type: String, required: true },
    direction: { type: String, enum: ['up', 'down'], required: true },
    amount: { type: Number, required: true },
    durationSec: { type: Number, required: true },
    triggerType: { type: String, enum: ['price', 'time'], required: true },
    triggerPrice: Number,
    triggerCondition: { type: String, enum: ['above', 'below'] },
    triggerAt: Date,
    validUntil: { type: Date, required: true },
    status: { type: String, enum: ['waiting', 'triggered', 'cancelled', 'failed', 'expired'], default: 'waiting', index: true },
    tradeId: { type: Schema.Types.ObjectId, ref: 'Trade' },
    failReason: String,
  },
  { timestamps: true },
);
export type PendingT = InferSchemaType<typeof pendingSchema> & { _id: Types.ObjectId };
export const PendingOrder = model('PendingOrder', pendingSchema);

const cfdSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    symbol: { type: String, required: true },
    side: { type: String, enum: ['buy', 'sell'], required: true },
    lots: { type: Number, required: true },
    contractSize: { type: Number, required: true },
    leverage: { type: Number, required: true },
    spread: { type: Number, required: true },
    openPrice: { type: Number, required: true },
    openTickId: { type: Schema.Types.ObjectId, required: true },
    margin: { type: Number, required: true }, // cents
    sl: { type: Number, default: null },
    tp: { type: Number, default: null },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    closePrice: Number,
    closeTickId: Schema.Types.ObjectId,
    pnl: { type: Number, default: 0 }, // cents
    closeReason: { type: String, enum: ['manual', 'sl', 'tp', 'stopout', 'close_all'] },
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,
  },
  { timestamps: true },
);
export type CfdT = InferSchemaType<typeof cfdSchema> & { _id: Types.ObjectId };
export const CfdPosition = model('CfdPosition', cfdSchema);

/** "By price" CFD order: opens a position when the executable price reaches limitPrice. */
const cfdOrderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    symbol: { type: String, required: true },
    side: { type: String, enum: ['buy', 'sell'], required: true },
    lots: { type: Number, required: true },
    limitPrice: { type: Number, required: true },
    sl: { type: Number, default: null },
    tp: { type: Number, default: null },
    status: { type: String, enum: ['waiting', 'filled', 'cancelled', 'failed'], default: 'waiting', index: true },
    positionId: { type: Schema.Types.ObjectId, ref: 'CfdPosition' },
    failReason: String,
  },
  { timestamps: true },
);
export type CfdOrderT = InferSchemaType<typeof cfdOrderSchema> & { _id: Types.ObjectId };
export const CfdOrder = model('CfdOrder', cfdOrderSchema);
