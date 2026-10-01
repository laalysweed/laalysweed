// End-to-end smoke test against a RUNNING server (npm start in another terminal).
// Usage: node scripts/smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? 'http://localhost:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function client() {
  let cookie = '';
  let token = '';
  const call = async (method, path, body) => {
    const res = await fetch(BASE + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => null);
    if (json?.accessToken) token = json.accessToken;
    return { status: res.status, body: json };
  };
  return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p) };
}

function check(name, cond, extra) {
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : ''}`);
  if (!cond) failures++;
}

const u = client();
const id = Date.now().toString(36);
const username = `smoke_${id}`.slice(0, 20);

let r = await u.get('/health');
check('health', r.status === 200, r);

r = await u.get(`/auth/check?username=${username}`);
check('username available', r.body?.available === true, r.body);

r = await u.post('/auth/register', { fullName: 'Smoke Tester', username, email: `${username}@example.com`, password: 'Password123', acceptTerms: true });
check('register', r.status === 201 && r.body?.accessToken, r.body);

r = await u.get('/me');
const demo = r.body?.accounts?.find((a) => a.type === 'demo');
const real = r.body?.accounts?.find((a) => a.type === 'real');
check('demo $10,000 + real $0', demo?.balance === 1_000_000 && real?.balance === 0, r.body?.accounts);

r = await u.post('/auth/refresh');
check('silent refresh (cookie rotation)', r.status === 200 && r.body?.accessToken, r.body);

r = await u.get('/market/assets');
check('assets listed', Array.isArray(r.body) && r.body.length >= 18, r.body?.length);
const otc = r.body.find((a) => a.symbol === 'EURUSD_OTC');
check('OTC quoting', otc?.fresh === true, otc);

r = await u.get('/market/candles?symbol=EURUSD_OTC&tf=5&limit=100');
check('candles', Array.isArray(r.body) && r.body.length > 50, r.body?.length);

const key = `smoke-${id}-1`;
r = await u.post('/trades', { symbol: 'EURUSD_OTC', direction: 'up', amount: 1000, durationSec: 5, idempotencyKey: key, accountId: demo.id, price: 999999 });
check('open trade (server price, client price ignored)', r.status === 201 && r.body?.openPrice !== 999999, r.body);
const tradeId = r.body?.id;
r = await u.post('/trades', { symbol: 'EURUSD_OTC', direction: 'up', amount: 1000, durationSec: 5, idempotencyKey: key, accountId: demo.id });
check('idempotent retry returns same trade', r.status === 200 && r.body?.id === tradeId, r.body);

r = await u.get('/me');
check('stake debited once', r.body.accounts.find((a) => a.type === 'demo').balance === 1_000_000 - 1000, r.body.accounts);

r = await u.post('/trades', { symbol: 'EURUSD_OTC', direction: 'up', amount: 5000, durationSec: 30, idempotencyKey: `smoke-${id}-2`, accountId: real.id });
check('real account with $0 is rejected', r.status === 400 && r.body?.error?.code === 'INSUFFICIENT_FUNDS', r.body);

await sleep(7000);
r = await u.get(`/trades/${tradeId}`);
check('trade settled from recorded ticks', ['won', 'lost', 'draw'].includes(r.body?.trade?.status) && r.body?.trade?.closeTickId && r.body?.ticks?.length > 3, r.body?.trade);
const settled = r.body.trade;
r = await u.get('/me');
const demoAfter = r.body.accounts.find((a) => a.type === 'demo').balance;
check('payout credited correctly', demoAfter === 1_000_000 - 1000 + settled.payout, { demoAfter, payout: settled.payout });

// ---- deposit (simulated M-Pesa) with 50% first-deposit bonus + Trader's Box ----
r = await u.get('/bonuses');
check('bonus offers + odds visible before opt-in', r.body?.offers?.length && r.body?.tradersBox?.odds?.length, r.body);
const termsVersion = r.body.termsVersion;
r = await u.post('/finance/deposits', { method: 'mpesa', amount: 5000, phone: '0712345678', bonusOffer: 'first50', bonusTermsVersion: termsVersion, tradersBox: true });
if (r.body?.error?.code === 'METHOD_UNAVAILABLE') {
  console.log('… deposit checks skipped: real payments only (start the server with MPESA_SIMULATE=true to test deposits with fake money)');
} else {
check('M-Pesa STK push created', r.status === 201 && r.body?.status === 'processing', r.body);
const depId = r.body.id;
await sleep(8000);
r = await u.get(`/finance/deposits/${depId}`);
check('deposit completed via callback', r.body?.status === 'completed', r.body);
r = await u.get('/me');
const realAfter = r.body.accounts.find((a) => a.type === 'real');
check('cash credited $50 (+box reward), bonus $25 separate', realAfter.balance >= 5000 && realAfter.bonusBalance === 2500, realAfter);

r = await u.get('/bonuses');
const active = r.body.bonuses.find((b) => b.status === 'active');
check('active bonus with turnover target', active && active.turnoverRequired === 2500 * 20, active);
check("Trader's Box roll recorded", r.body.rolls.length === 1, r.body.rolls);

r = await u.post(`/bonuses/${active.id}/cancel`);
r = await u.get('/me');
check('cancel bonus removes only bonus funds', r.body.accounts.find((a) => a.type === 'real').bonusBalance === 0 && r.body.accounts.find((a) => a.type === 'real').balance === realAfter.balance, r.body.accounts);
}

// ---- withdrawal requires verified e-mail ----
r = await u.post('/finance/withdrawals', { method: 'mpesa', amount: 1000, phone: '0712345678' });
check('withdrawal blocked until e-mail verified', r.status === 403 && r.body?.error?.code === 'EMAIL_UNVERIFIED', r.body);

// ---- admin ----
const a = client();
r = await a.post('/auth/login', { identifier: 'admin@y2markets.site', password: 'Admin@12345' });
check('admin login', r.status === 200, r.body);
r = await a.get('/admin/stats');
check('admin stats', r.status === 200 && r.body.users >= 2, r.body);
r = await a.get(`/admin/trades/${tradeId}/audit`);
check('trade audit re-verifies from stored ticks', r.body?.verified === true, { verified: r.body?.verified, recomputed: r.body?.recomputed, trade: r.body?.trade?.status });
r = await u.get('/admin/stats');
check('non-admin blocked from admin API', r.status === 403, r.status);

// Verify user e-mail via admin shortcut is not available — mark verified directly by token flow is e-mail based; skip.
r = await a.get('/admin/users?q=' + username);
const userId = r.body?.rows?.[0]?.id;
check('admin user search', !!userId, r.body);

// ---- CFD ----
r = await u.post('/cfd/positions', { accountId: demo.id, symbol: 'BTCUSDT', side: 'buy', lots: 0.01 });
if (r.status === 400 && r.body?.error?.code === 'MARKET_STALE') console.log('… CFD skipped (Binance not reachable)');
else {
  check('CFD open', r.status === 201, r.body);
  const pid = r.body.id;
  r = await u.post(`/cfd/positions/${pid}/close`);
  check('CFD close', r.body?.status === 'closed', r.body);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed ✔');
process.exit(failures ? 1 : 0);
