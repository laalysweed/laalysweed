import { Schema, model, InferSchemaType, Types } from 'mongoose';

const userBonusSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    offer: { type: String, enum: ['first50', 'welcome100'], required: true },
    amount: { type: Number, required: true }, // cents granted
    turnoverRequired: { type: Number, required: true }, // cents
    turnoverDone: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active', index: true },
    depositId: { type: Schema.Types.ObjectId, ref: 'Deposit' },
    termsVersion: String,
    acceptedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    convertedAmount: Number,
    forfeitedAmount: Number,
  },
  { timestamps: true },
);
export type UserBonusT = InferSchemaType<typeof userBonusSchema> & { _id: Types.ObjectId };
export const UserBonus = model('UserBonus', userBonusSchema);

const boxRollSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    depositId: { type: Schema.Types.ObjectId, ref: 'Deposit', required: true, unique: true },
    roll: { type: Number, required: true },
    weightTotal: { type: Number, required: true },
    rewardLabel: String,
    rewardAmount: Number, // cents
  },
  { timestamps: true },
);
export const TradersBoxRoll = model('TradersBoxRoll', boxRollSchema);

/** Generic key/value settings editable by admins (bonus config etc). */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
export const Setting = model('Setting', settingSchema);
