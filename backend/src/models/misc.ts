import { Schema, model, InferSchemaType, Types } from 'mongoose';

const kycSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    docType: { type: String, enum: ['id_front', 'id_back', 'selfie', 'proof_of_address'], required: true },
    path: { type: String, required: true },
    originalName: String,
    mime: String,
    size: Number,
  },
  { timestamps: true },
);
export const KycDocument = model('KycDocument', kycSchema);

const chatSchema = new Schema(
  {
    conversationUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    from: { type: String, enum: ['user', 'support'], required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true, maxlength: 2000 },
    readByUser: { type: Boolean, default: false },
    readBySupport: { type: Boolean, default: false },
  },
  { timestamps: true },
);
chatSchema.index({ conversationUserId: 1, createdAt: -1 });
export type ChatT = InferSchemaType<typeof chatSchema> & { _id: Types.ObjectId };
export const ChatMessage = model('ChatMessage', chatSchema);

const tournamentSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    entryFee: { type: Number, default: 0 }, // cents (real cash)
    startingBalance: { type: Number, default: 100_000 }, // cents (tournament account)
    prizes: { type: [Number], default: [] }, // cents by rank
    status: { type: String, enum: ['upcoming', 'running', 'finished'], default: 'upcoming', index: true },
    paidOut: { type: Boolean, default: false },
    results: [{ userId: Schema.Types.ObjectId, username: String, rank: Number, balance: Number, prize: Number }],
  },
  { timestamps: true },
);
export type TournamentT = InferSchemaType<typeof tournamentSchema> & { _id: Types.ObjectId };
export const Tournament = model('Tournament', tournamentSchema);

const signalSchema = new Schema(
  {
    symbol: { type: String, required: true, index: true },
    direction: { type: String, enum: ['up', 'down'], required: true },
    timeframeSec: { type: Number, required: true },
    confidence: { type: Number, required: true },
    price: { type: Number, required: true },
    reason: String,
    expiresAt: { type: Date, required: true },
    result: { type: String, enum: ['pending', 'hit', 'miss', 'flat'], default: 'pending', index: true },
    closePrice: Number,
  },
  { timestamps: true },
);
export type SignalT = InferSchemaType<typeof signalSchema> & { _id: Types.ObjectId };
export const Signal = model('Signal', signalSchema);

const followSchema = new Schema(
  {
    followerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    leaderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    amount: { type: Number, required: true }, // cents per copied trade
    active: { type: Boolean, default: true },
    copiedCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
followSchema.index({ followerId: 1, leaderId: 1 }, { unique: true });
export const Follow = model('Follow', followSchema);
