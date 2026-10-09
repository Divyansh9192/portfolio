/**
 * credit_ledger as backend/app/core/credits.py writes it.
 *  - available = SUM(topup + release - commit - hold)                (credits.py:31-51)
 *  - hold: check-then-insert, raises when the balance is short       (credits.py:54-79)
 *  - commit: mutates the run's HOLD row into COMMIT, in place         (credits.py:82-103)
 *  - release: appends a RELEASE row; the HOLD row stays a HOLD row    (credits.py:145-170)
 */

export type LedgerEntryType = "hold" | "commit" | "release" | "topup";

export interface LedgerRow {
  id: number;
  runId: string | null;
  type: LedgerEntryType;
  amount: number;
  note: string;
}

export interface Ledger {
  rows: LedgerRow[];
  seq: number;
  /** Sums of rows compacted away (settled runs the sim no longer tracks). Same SUM, fewer rows. */
  carry: Record<LedgerEntryType, number>;
}

export function createLedger(): Ledger {
  return { rows: [], seq: 0, carry: { hold: 0, commit: 0, release: 0, topup: 0 } };
}

/** Move a settled run's rows into `carry`, keeping every total identical. */
export function compactRun(l: Ledger, runId: string): void {
  const keep: LedgerRow[] = [];
  for (const r of l.rows) {
    if (r.runId === runId) l.carry[r.type] += r.amount;
    else keep.push(r);
  }
  l.rows = keep;
}

export function availableCredits(l: Ledger): number {
  let sum = l.carry.topup + l.carry.release - l.carry.commit - l.carry.hold;
  for (const r of l.rows) {
    if (r.type === "topup" || r.type === "release") sum += r.amount;
    else sum -= r.amount;
  }
  return sum;
}

export function topup(l: Ledger, amount: number, note = "credit topup"): LedgerRow {
  if (amount <= 0) throw new Error(`topup amount must be positive, got ${amount}`);
  const row: LedgerRow = { id: ++l.seq, runId: null, type: "topup", amount, note };
  l.rows.push(row);
  return row;
}

/**
 * hold_credits. `seenAvailable` lets a caller model the check-then-insert race: concurrent
 * requests in one workspace each read the balance before any of them inserts (no lock).
 */
export function hold(l: Ledger, runId: string, amount: number, seenAvailable = availableCredits(l)): LedgerRow {
  if (seenAvailable < amount) {
    throw new InsufficientCredits(seenAvailable, amount);
  }
  const row: LedgerRow = { id: ++l.seq, runId, type: "hold", amount, note: "hold on workflow enqueue" };
  l.rows.push(row);
  return row;
}

/** commit_credits: first HOLD row for the run becomes COMMIT. No-op (warning) when there is none. */
export function commit(l: Ledger, runId: string): LedgerRow | null {
  const row = l.rows.find((r) => r.runId === runId && r.type === "hold");
  if (!row) return null;
  row.type = "commit";
  row.note = "commit on workflow success";
  return row;
}

/** release_credits: looks up the HOLD row (still present after an earlier release) and appends RELEASE. */
export function release(l: Ledger, runId: string): LedgerRow | null {
  const holdRow = l.rows.find((r) => r.runId === runId && r.type === "hold");
  if (!holdRow) return null;
  const row: LedgerRow = { id: ++l.seq, runId, type: "release", amount: holdRow.amount, note: "release on workflow failure/cancel" };
  l.rows.push(row);
  return row;
}

export interface LedgerTotals {
  topup: number;
  hold: number;
  commit: number;
  release: number;
  available: number;
  /** HOLD rows not yet offset by a RELEASE: credits reserved by runs still in flight. */
  openHolds: number;
}

export function ledgerTotals(l: Ledger): LedgerTotals {
  const t = { ...l.carry };
  const releasedByRun = new Map<string, number>();
  for (const r of l.rows) {
    t[r.type] += r.amount;
    if (r.type === "release" && r.runId) releasedByRun.set(r.runId, (releasedByRun.get(r.runId) ?? 0) + r.amount);
  }
  // Compacted runs are settled, so only live rows can hold credits open.
  let openHolds = 0;
  for (const r of l.rows) {
    if (r.type === "hold" && r.runId && !releasedByRun.has(r.runId)) openHolds += r.amount;
  }
  return { ...t, available: t.topup + t.release - t.commit - t.hold, openHolds };
}

export class InsufficientCredits extends Error {
  constructor(
    readonly available: number,
    readonly required: number,
  ) {
    super(`Insufficient credits: available=${available} required=${required}`);
  }
}
