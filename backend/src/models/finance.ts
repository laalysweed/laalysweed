import { Schema, model, InferSchemaType, Types } from 'mongoose';

// usdt_trc20 / usdt_bep20 are kept only for older records; new crypto deposits use 'crypto' + coin.
export const DEPOSIT_METHODS = ['mpesa', 'crypto', 'airtel', 'usdt_trc20', 'usdt_bep20', 'bybit', 'card'] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

const depositSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    method: { type: String, enum: DEPOSIT_METHODS, required: true },
    amount: { type: Number, required: true }, // USD cents credited
    localAmount: Number,
    localCurrency: String,
    phone: String,
    status: {
      type: String,
      enum: ['pending', 'processing', 'awaiting_review', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    bonusOffer: { type: String, enum: ['first50', 'welcome100', null], default: null },
    bonusTermsVersion: String,
    tradersBox: { type: Boolean, default: false },
    provider: {
      merchantRequestId: String,
      checkoutRequestId: { type: String, index: true, sparse: true },
      receipt: String,
      txHash: String,
      raw: Schema.Types.Mixed,
    },
    crypto: {
      coin: String, // wallet code, e.g. usdt_trc20
      symbol: String, // USDT
      network: String,
      address: String, // company address shown to the user at the time of the deposit
      coinAmount: Number, // approximate amount of coin to send
    },
    failureReason: String,
    // cancelled | insufficient_funds | wrong_pin | timeout | unreachable | busy | amount_mismatch | error
    failureCode: String,
    completedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export type DepositT = InferSchemaType<typeof depositSchema> & { _id: Types.ObjectId };
export const Deposit = model('Deposit', depositSchema);

const withdrawalSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    method: { type: String, enum: ['mpesa', 'usdt_trc20', 'usdt_bep20'], required: true },
    amount: { type: Number, required: true }, // cents
    localAmount: Number,
    localCurrency: String,
    phone: String,
    address: String,
    status: {
      type: String,
      enum: ['pending_review', 'processing', 'paid', 'rejected', 'failed', 'cancelled'],
      default: 'pending_review',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewNote: String,
    provider: {
      conversationId: String,
      originatorConversationId: { type: String, index: true, sparse: true },
      transactionId: String,
      txRef: String,
      raw: Schema.Types.Mixed,
    },
    paidAt: Date,
  },
  { timestamps: true },
);
export type WithdrawalT = InferSchemaType<typeof withdrawalSchema> & { _id: Types.ObjectId };
export const Withdrawal = model('Withdrawal', withdrawalSchema);
