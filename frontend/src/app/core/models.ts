/* Types mirrored from the backend's public DTOs. Money is always integer cents. */

export type Role = 'user' | 'admin';
export type AccountType = 'demo' | 'real' | 'tournament';
export type Direction = 'up' | 'down';

export interface User {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  country: string;
  phone: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
  level: string;
  timezoneOffset: number;
  kycStatus: 'none' | 'pending' | 'approved' | 'rejected';
  kycNote: string | null;
  pinnedAssets: string[];
  dismissedPromos: string[];
  onboarding: { welcomeSeen: boolean; goodLuckSeen: boolean; tourStep: number; tourDone: boolean };
  activeAccountId: string | null;
  withdrawalPopup?: WithdrawalPopupConfig | null;
  createdAt: string;
}

export interface WithdrawalPopupConfig {
  enabled: boolean;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  blocking: boolean;
  buttonText: string;
  buttonAction: 'close' | 'support' | 'kyc' | 'deposit';
}

export interface Account {
  id: string;
  type: AccountType;
  tournamentId: string | null;
  tournamentName?: string | null;
  currency: string;
  balance: number;
  bonusBalance: number;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface Asset {
  symbol: string;
  name: string;
  category: 'crypto' | 'currency' | 'commodity' | 'stock' | 'index';
  source: 'binance' | 'otc';
  icon: string;
  precision: number;
  payout: number;
  minTrade: number;
  maxTrade: number;
  cfd: { spread: number; leverage: number; contractSize: number } | null;
  price: number | null;
  fresh: boolean;
  changePct: number;
}

export interface SummaryRow {
  symbol: string;
  price: number;
  changePct: number;
  fresh: boolean;
}

export interface Tick {
  s: string;
  p: number;
  t: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  id: string;
  accountId: string;
  accountType: AccountType;
  symbol: string;
  direction: Direction;
  amount: number;
  payoutPct: number;
  openPrice: number;
  openedAt: string;
  durationSec: number;
  expiresAt: string;
  status: 'open' | 'won' | 'lost' | 'draw';
  closePrice: number | null;
  closedAt: string | null;
  payout: number;
  profit: number;
  source: 'manual' | 'pending' | 'copy' | 'ai';
  openTickId: string;
  closeTickId: string | null;
  username?: string;
  userId?: string;
}

export interface PendingOrder {
  id: string;
  accountId: string;
  symbol: string;
  direction: Direction;
  amount: number;
  durationSec: number;
  triggerType: 'price' | 'time';
  triggerPrice: number | null;
  triggerCondition: 'above' | 'below' | null;
  triggerAt: string | null;
  validUntil: string;
  status: 'waiting' | 'triggered' | 'cancelled' | 'failed' | 'expired';
  tradeId: string | null;
  failReason: string | null;
  createdAt: string;
}

export interface CfdPosition {
  id: string;
  accountId: string;
  symbol: string;
  side: 'buy' | 'sell';
  lots: number;
  contractSize: number;
  leverage: number;
  spread: number;
  openPrice: number;
  margin: number;
  sl: number | null;
  tp: number | null;
  status: 'open' | 'closed';
  closePrice: number | null;
  pnl: number;
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface PaymentMethod {
  id: 'mpesa' | 'crypto' | 'airtel' | 'usdt_trc20' | 'usdt_bep20' | 'bybit' | 'card';
  name: string;
  logo: string;
  minDeposit: number;
  eta: string;
  available: boolean;
  note?: string;
  popular: boolean;
}

export interface Deposit {
  id: string;
  method: PaymentMethod['id'];
  amount: number;
  localAmount: number | null;
  localCurrency: string | null;
  phone: string | null;
  status: 'pending' | 'processing' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
  bonusOffer: 'first50' | 'welcome100' | null;
  tradersBox: boolean;
  receipt: string | null;
  txHash: string | null;
  failureReason: string | null;
  failureCode?: string | null;
  createdAt: string;
  completedAt: string | null;
  payTo?: { coin: string; network: string; address: string; coinAmount: number | null; qr: string };
  crypto?: { coin: string; symbol: string; network: string; address: string; coinAmount: number | null } | null;
  tradersBoxResult?: { label: string; amount: number; roll: number; weightTotal: number } | null;
  username?: string;
  email?: string;
  userId?: string;
}

export interface Withdrawal {
  id: string;
  method: 'mpesa' | 'usdt_trc20' | 'usdt_bep20';
  amount: number;
  localAmount: number | null;
  localCurrency: string | null;
  phone: string | null;
  address: string | null;
  status: 'pending_review' | 'processing' | 'paid' | 'rejected' | 'failed' | 'cancelled';
  reviewNote: string | null;
  txRef: string | null;
  createdAt: string;
  paidAt: string | null;
  username?: string;
  email?: string;
  userId?: string;
  kycStatus?: string;
  emailVerified?: boolean;
}

export interface BonusOffer {
  key: 'first50' | 'welcome100';
  title: string;
  summary: string;
  terms: string[];
  pct: number;
  minDeposit: number;
  maxBonus: number;
  turnoverMultiplier: number;
  eligible: boolean;
}

export interface UserBonus {
  id: string;
  offer: 'first50' | 'welcome100';
  amount: number;
  turnoverRequired: number;
  turnoverDone: number;
  status: 'active' | 'completed' | 'cancelled';
  termsVersion: string;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  convertedAmount: number | null;
  forfeitedAmount: number | null;
}

export interface BonusOverview {
  offers: BonusOffer[];
  termsVersion: string;
  tradersBox: {
    enabled: boolean;
    eligible: boolean;
    minDeposit: number;
    odds: { label: string; amount: number; probability: number }[];
    expectedValue: number;
    terms: string[];
  };
  bonuses: UserBonus[];
  rolls: { id: string; label: string; amount: number; roll: number; weightTotal: number; createdAt: string }[];
}

export interface HistoryRow {
  id: string;
  kind: 'deposit' | 'withdrawal' | 'internal';
  method: string;
  amount: number;
  status: string;
  reference: string;
  createdAt: string;
}

export interface ChatMsg {
  id: string;
  from: 'user' | 'support';
  text: string;
  createdAt: string;
  read: boolean;
}

export interface Tournament {
  id: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  entryFee: number;
  startingBalance: number;
  prizes: number[];
  prizePool: number;
  status: 'upcoming' | 'running' | 'finished';
  joined?: boolean;
  accountId?: string | null;
  participants?: number;
  leaderboard?: { rank: number; username: string; country: string; balance: number; me: boolean }[];
  myRank?: number | null;
  results?: { username: string; rank: number; balance: number; prize: number }[];
}

export interface Signal {
  id: string;
  symbol: string;
  direction: Direction;
  timeframeSec: number;
  confidence: number;
  price: number;
  reason: string;
  expiresAt: string;
  result: 'pending' | 'hit' | 'miss' | 'flat';
  closePrice: number | null;
  createdAt: string;
}

export interface TraderStats {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  country: string;
  level: string;
  trades: number;
  winRate: number;
  profit: number;
  roi: number;
  followers: number;
  recent?: Trade[];
  following?: { amount: number; accountId: string } | null;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/** A coin users can deposit (company wallet configured by admins). */
export interface CryptoCoin {
  code: string;
  coin: string;
  name: string;
  network: string;
  popular: boolean;
  coinAmount: number | null;
}
