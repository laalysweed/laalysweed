/**
 * Optional demo data: creates a few public traders with trade history so Social Trading,
 * leaderboards and admin screens have something to show.  Run:  npm run seed
 */
import { connectMongo, disconnectMongo } from '../db/mongo';
import { bootstrap } from '../bootstrap';
import { User } from '../models/user';
import { Account } from '../models/account';
import { createUserWithAccounts } from '../services/auth.service';
import { withTxn } from '../services/ledger.service';

const TRADERS = [
  { fullName: 'Amina Wanjiru', username: 'amina_fx', email: 'amina@example.com' },
  { fullName: 'Brian Otieno', username: 'brian_trades', email: 'brian@example.com' },
  { fullName: 'Grace Mutua', username: 'grace_m', email: 'grace@example.com' },
];

async function main() {
  await connectMongo();
  await bootstrap();
  for (const t of TRADERS) {
    if (await User.exists({ username: t.username })) continue;
    const u = await withTxn((s) => createUserWithAccounts(s, { ...t, password: 'Password123', emailVerified: true }));
    await User.updateOne({ _id: u._id }, { $set: { isPublic: true, 'onboarding.welcomeSeen': true, 'onboarding.goodLuckSeen': true, 'onboarding.tourDone': true } });
    console.log(`created ${t.username} / Password123`);
  }
  console.log(`accounts: ${await Account.countDocuments()}`);
  await disconnectMongo();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
