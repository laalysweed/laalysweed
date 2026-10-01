/** All money is integer cents. These helpers are the only place floats may touch money. */
export const dollarsToCents = (d: number) => Math.round(d * 100);
export const centsToDollars = (c: number) => c / 100;
export const fmtUsd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Percentage of an amount in cents, rounded down (never over-pay due to rounding). */
export const pctOf = (cents: number, pct: number) => Math.floor((cents * pct) / 100);

export function assertCents(n: number) {
  if (!Number.isSafeInteger(n)) throw new Error(`Money must be integer cents, got ${n}`);
}

export const usdToKes = (cents: number, rate: number) => Math.ceil((cents / 100) * rate);
export const kesToUsdCents = (kes: number, rate: number) => Math.floor((kes / rate) * 100);
