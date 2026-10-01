import { Schema, model, InferSchemaType, Types, HydratedDocument } from 'mongoose';

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    blocked: { type: Boolean, default: false },

    emailVerified: { type: Boolean, default: false },
    emailVerifyTokenHash: { type: String, index: true, sparse: true },
    emailVerifyExpires: Date,
    emailCode: {
      hash: String,
      expires: Date,
      attempts: { type: Number, default: 0 },
      sentAt: Date,
    },
    resetTokenHash: { type: String, index: true, sparse: true },
    resetExpires: Date,

    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String },
      pendingSecret: { type: String },
    },

    referredBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    country: { type: String, default: 'KE' },
    phone: { type: String },
    avatarUrl: { type: String },
    isPublic: { type: Boolean, default: false },
    level: { type: String, default: 'Beginner' },
    timezoneOffset: { type: Number, default: 180 }, // minutes east of UTC (Nairobi = +180)
    kycStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    kycNote: String,

    pinnedAssets: { type: [String], default: [] },
    dismissedPromos: { type: [String], default: [] },
    onboarding: {
      welcomeSeen: { type: Boolean, default: false },
      goodLuckSeen: { type: Boolean, default: false },
      tourStep: { type: Number, default: 0 },
      tourDone: { type: Boolean, default: false },
    },
    activeAccountId: { type: Schema.Types.ObjectId, ref: 'Account' },
    withdrawalPopup: {
      enabled: { type: Boolean, default: false },
      title: { type: String, default: '' },
      message: { type: String, default: '' },
      type: { type: String, enum: ['info', 'warning', 'error', 'success'], default: 'warning' },
      blocking: { type: Boolean, default: false },
      buttonText: { type: String, default: 'Understood' },
      buttonAction: { type: String, enum: ['close', 'support', 'kyc', 'deposit'], default: 'close' },
    },
    engineMode: { type: String, enum: ['default', 'always_win', 'always_lose', 'custom', 'natural'], default: 'default' },
    customWinRate: { type: Number, min: 0, max: 100, default: null },
    lastIp: String,
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export type UserT = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export type UserDoc = HydratedDocument<UserT>;
export const User = model('User', userSchema);

/** The shape the client sees. Never leak hashes or secrets. */
export function publicUser(u: UserT) {
  return {
    id: String(u._id),
    fullName: u.fullName,
    username: u.username,
    email: u.email,
    role: u.role,
    emailVerified: u.emailVerified,
    twoFactorEnabled: !!u.twoFactor?.enabled,
    country: u.country,
    phone: u.phone ?? null,
    avatarUrl: u.avatarUrl ?? null,
    isPublic: u.isPublic,
    level: u.level,
    timezoneOffset: u.timezoneOffset,
    kycStatus: u.kycStatus,
    kycNote: u.kycNote ?? null,
    pinnedAssets: u.pinnedAssets,
    dismissedPromos: u.dismissedPromos,
    onboarding: u.onboarding,
    activeAccountId: u.activeAccountId ? String(u.activeAccountId) : null,
    withdrawalPopup: u.withdrawalPopup ?? null,
    engineMode: u.engineMode ?? 'default',
    customWinRate: u.customWinRate ?? null,
    createdAt: (u as unknown as { createdAt: Date }).createdAt,
  };
}

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedAt: Date,
    userAgent: String,
    ip: String,
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
export const Session = model('Session', sessionSchema);
