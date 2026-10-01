import mongoose, { ClientSession, Types } from 'mongoose';
import { Account, AccountT, LedgerEntry, LedgerType, publicAccount } from '../models/account';
import { AppError } from '../lib/errors';
import { assertCents } from '../lib/money';
import { toUser } from '../realtime/io';

export interface EntryInput {
  accountId: Types.ObjectId | string;
  type: LedgerType;
  bucket: 'cash' | 'bonus';
  amount: number; // signed cents
  refKind?: string;
  refId?: Types.ObjectId | string;
  note?: string;
  actorId?: Types.ObjectId | string;
}

/**
 * The ONLY way balances change. Must run inside a transaction session.
 * Debits are conditional on sufficient funds (atomic $gte guard), so a balance can never go negative.
 */
export async function postEntry(session: ClientSession, e: EntryInput): Promise<AccountT> {
  assertCents(e.amount);
  if (e.amount === 0) {
    const acc = await Account.findById(e.accountId).session(session);
    if (!acc) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
    return acc.toObject();
  }
  const field = e.bucket === 'cash' ? 'balance' : 'bonusBalance';
  const filter: Record<string, unknown> = { _id: e.accountId };
  if (e.amount < 0) filter[field] = { $gte: -e.amount };
  const acc = await Account.findOneAndUpdate(filter, { $inc: { [field]: e.amount } }, { new: true, session }).lean<AccountT>();
  if (!acc) throw new AppError(400, 'INSUFFICIENT_FUNDS', 'Insufficient funds');
  await LedgerEntry.create(
    [
      {
        userId: acc.userId,
        accountId: acc._id,
        accountType: acc.type,
        type: e.type,
        bucket: e.bucket,
        amount: e.amount,
        balanceAfter: acc[field],
        refKind: e.refKind,
        refId: e.refId,
        note: e.note,
        actorId: e.actorId,
      },
    ],
    { session },
  );
  return acc;
}

/** Runs fn in a MongoDB transaction with automatic retry on transient errors. */
export async function withTxn<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}

/** Push fresh account balances to the user's sockets (call after commit). */
export async function emitAccounts(userId: Types.ObjectId | string) {
  const accounts = await Account.find({ userId }).lean<AccountT[]>();
  toUser(userId, 'accounts', accounts.map(publicAccount));
}
