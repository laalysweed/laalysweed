import { Schema, model, InferSchemaType, Types } from 'mongoose';

export const ASSET_CATEGORIES = ['crypto', 'currency', 'commodity', 'stock', 'index'] as const;

const assetSchema = new Schema(
  {
    symbol: { type: String, required: true, unique: true }, // e.g. BTCUSD_OTC, BTCUSDT
    name: { type: String, required: true }, // e.g. "BTC/USD OTC"
    category: { type: String, enum: ASSET_CATEGORIES, required: true },
    source: { type: String, enum: ['binance', 'otc'], required: true },
    binanceSymbol: { type: String },
    icon: { type: String, default: '' },
    precision: { type: Number, default: 2 },
    payout: { type: Number, default: 80, min: 10, max: 100 }, // % profit on win
    enabled: { type: Boolean, default: true },
    sort: { type: Number, default: 100 },
    minTradeCents: { type: Number, default: 100 },
    maxTradeCents: { type: Number, default: 100_000 },
    otc: {
      basePrice: Number,
      volatility: Number, // annualised-ish sigma for the log random walk
      meanReversion: Number,
    },
    cfd: {
      enabled: { type: Boolean, default: false },
      spread: { type: Number, default: 0 },
      leverage: { type: Number, default: 100 },
      contractSize: { type: Number, default: 1 },
    },
  },
  { timestamps: true },
);

export type AssetT = InferSchemaType<typeof assetSchema> & { _id: Types.ObjectId };
export const Asset = model('Asset', assetSchema);

/**
 * Every price tick, stored in a MongoDB time-series collection for audit.
 * `_id` is generated in-process before insert so trades can reference ticks immediately.
 */
const tickSchema = new Schema(
  {
    ts: { type: Date, required: true },
    symbol: { type: String, required: true },
    price: { type: Number, required: true },
    vol: { type: Number, default: 0 },
  },
  {
    timeseries: { timeField: 'ts', metaField: 'symbol', granularity: 'seconds' },
    versionKey: false,
    autoIndex: false,
  },
);
tickSchema.index({ symbol: 1, ts: 1 });

export type TickT = InferSchemaType<typeof tickSchema> & { _id: Types.ObjectId };
export const Tick = model('Tick', tickSchema);
