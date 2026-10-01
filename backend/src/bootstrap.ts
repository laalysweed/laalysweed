import { Asset } from './models/market';
import { User } from './models/user';
import { Tournament } from './models/misc';
import { Setting } from './models/bonus';
import { ASSET_CATALOG } from './market/asset-catalog';
import { DEFAULT_BONUS_CONFIG } from './services/settings.service';
import { createUserWithAccounts } from './services/auth.service';
import { withTxn } from './services/ledger.service';
import { env } from './config/env';
import { createLogger } from './lib/logger';

const log = createLogger('bootstrap');

/** Idempotent first-boot data: instruments, bonus config, admin user, a starter tournament. */
export async function bootstrap() {
  for (const a of ASSET_CATALOG) {
    await Asset.updateOne({ symbol: a.symbol }, { $setOnInsert: a }, { upsert: true });
  }
  await Setting.updateOne({ key: 'bonuses' }, { $setOnInsert: { value: DEFAULT_BONUS_CONFIG } }, { upsert: true });

  if (!(await User.exists({ role: 'admin' }))) {
    await withTxn((s) =>
      createUserWithAccounts(s, {
        fullName: 'Y2 Admin',
        username: 'y2admin',
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
        role: 'admin',
        emailVerified: true,
      }),
    );
    log.info(`created admin user ${env.ADMIN_EMAIL} (username: y2admin), change the password after first login`);
  }

  if (!(await Tournament.exists({}))) {
    const now = Date.now();
    await Tournament.create([
      {
        name: 'Weekly Free Roll',
        description: 'Free entry. Everyone starts with $1,000 of tournament funds; the highest balance at the end wins.',
        startsAt: new Date(now - 60_000),
        endsAt: new Date(now + 7 * 86_400_000),
        entryFee: 0,
        startingBalance: 100_000,
        prizes: [5000, 2500, 1000],
        status: 'running',
      },
      {
        name: 'Weekend Sprint',
        description: '$1 entry, 48 hours, top 5 paid.',
        startsAt: new Date(now + 2 * 86_400_000),
        endsAt: new Date(now + 4 * 86_400_000),
        entryFee: 100,
        startingBalance: 100_000,
        prizes: [10_000, 5000, 2500, 1000, 500],
      },
    ]);
    log.info('created starter tournaments');
  }
}
