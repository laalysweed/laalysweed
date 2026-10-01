const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** cents -> "$1,234.56" */
export const money = (cents: number | null | undefined) => usd.format((cents ?? 0) / 100);

/** cents -> "+$7.90" / "-$10.00" */
export const signedMoney = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${usd.format(Math.abs(cents) / 100)}`;

export const price = (p: number | null | undefined, precision = 2) =>
  p == null ? '—' : p.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });

export const pct = (p: number, digits = 2) => `${p > 0 ? '+' : ''}${p.toFixed(digits)}%`;

export function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function shortDuration(sec: number) {
  if (sec < 60) return `S${sec}`;
  if (sec < 3600) return `M${Math.round(sec / 60)}`;
  return `H${Math.round(sec / 3600)}`;
}

/** Time in the user's chosen UTC offset (minutes), e.g. "11:16:26". */
export function clock(ms: number, offsetMin: number, withSeconds = true) {
  const d = new Date(ms + offsetMin * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${withSeconds ? `:${p(d.getUTCSeconds())}` : ''}`;
}

export const utcLabel = (offsetMin: number) => `UTC${offsetMin >= 0 ? '+' : '−'}${Math.abs(offsetMin / 60)}`;

export function dateTime(iso: string | Date | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export const METHOD_LABELS: Record<string, string> = {
  crypto: 'Cryptocurrency',
  mpesa: 'M-Pesa',
  airtel: 'Airtel Money',
  usdt_trc20: 'USDT TRC-20',
  usdt_bep20: 'USDT BEP20',
  bybit: 'ByBit Pay',
  card: 'Visa / Mastercard',
};

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  awaiting_review: 'Under review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  pending_review: 'Under review',
  paid: 'Paid',
  rejected: 'Rejected',
};

export const statusTone = (s: string) =>
  ['completed', 'paid', 'won', 'approved', 'hit'].includes(s)
    ? 'green'
    : ['failed', 'rejected', 'lost', 'cancelled', 'miss'].includes(s)
      ? 'red'
      : ['processing', 'pending_review', 'awaiting_review', 'pending'].includes(s)
        ? 'amber'
        : '';
