/**
 * Maps M-Pesa STK result codes (Daraja codes, also passed through by PayHero) to a clear outcome.
 * "cancelled" is kept separate from "failed" so the user sees exactly what happened.
 */
export type StkFailure = 'cancelled' | 'insufficient_funds' | 'wrong_pin' | 'timeout' | 'unreachable' | 'busy' | 'error';

export interface StkOutcome {
  status: 'cancelled' | 'failed';
  code: StkFailure;
  message: string;
}

const BY_CODE: Record<string, StkOutcome> = {
  '1032': { status: 'cancelled', code: 'cancelled', message: 'You cancelled the M-Pesa prompt.' },
  '1': { status: 'failed', code: 'insufficient_funds', message: 'Your M-Pesa balance is insufficient for this payment.' },
  '2001': { status: 'failed', code: 'wrong_pin', message: 'The M-Pesa PIN entered was incorrect.' },
  '1037': { status: 'failed', code: 'unreachable', message: 'We could not reach your phone. Make sure it is on and has network, then try again.' },
  '1019': { status: 'failed', code: 'timeout', message: 'The M-Pesa prompt expired before it was completed.' },
  '1001': { status: 'failed', code: 'busy', message: 'Another M-Pesa transaction is in progress on your line. Please wait a moment and try again.' },
  '1025': { status: 'failed', code: 'error', message: 'M-Pesa could not send the prompt. Please try again.' },
  '9999': { status: 'failed', code: 'error', message: 'M-Pesa could not send the prompt. Please try again.' },
};

export function stkOutcome(resultCode: unknown, resultDesc?: string): StkOutcome {
  const byCode = BY_CODE[String(resultCode ?? '').trim()];
  if (byCode) return byCode;
  // Fall back to the description text when a gateway uses its own codes.
  const d = (resultDesc ?? '').toLowerCase();
  if (d.includes('cancel')) return BY_CODE['1032']!;
  if (d.includes('insufficient') || d.includes('balance')) return BY_CODE['1']!;
  if (d.includes('pin') || d.includes('initiator information')) return BY_CODE['2001']!;
  if (d.includes('timeout') || d.includes('timed out') || d.includes('expired')) return BY_CODE['1019']!;
  if (d.includes('cannot be reached') || d.includes('unreachable')) return BY_CODE['1037']!;
  return { status: 'failed', code: 'error', message: resultDesc || 'The M-Pesa payment was not completed.' };
}
