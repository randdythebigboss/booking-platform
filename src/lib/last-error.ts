/**
 * The last error code the application mapped, for support to ask about.
 *
 * A *code*, never a message and never a payload: `SLOT_TAKEN`, `OFFLINE`,
 * `PAYMENT_HOLD_EXPIRED`. Codes are language-neutral, carry nothing about
 * anybody, and are exactly what somebody helping over a phone call needs to
 * hear. A message would eventually contain a name or an address, because
 * messages always do.
 *
 * In memory only. Nothing is written to storage, so nothing survives a reload
 * and nothing is left behind on a shared device.
 */

let lastCode: string | null = null;
let lastAt: Date | null = null;

export function recordErrorCode(code: string): void {
  lastCode = code;
  lastAt = new Date();
}

export function lastErrorCode(): { code: string; at: Date } | null {
  return lastCode ? { code: lastCode, at: lastAt ?? new Date() } : null;
}

/** Test helper, and what a support session should do when it is finished. */
export function forgetLastError(): void {
  lastCode = null;
  lastAt = null;
}
