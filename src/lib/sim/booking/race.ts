/**
 * Two transactions racing for the last room, as an interpreter over row locks and uncommitted writes.
 *
 * Mode "lock" is the real code path of POST /api/v1/bookings/init (@Transactional initialiseBooking):
 *   1. findAndLockAvailableInventory: SELECT ... WHERE (total - booked - reserved) >= :roomsCount,
 *      @Lock(PESSIMISTIC_WRITE). Rows another transaction has locked make this one wait.
 *   2. inventoryList.size() != DAYS.between(checkIn, checkOut) + 1  ->  IllegalStateException (500).
 *   3. initBooking: UPDATE ... SET reservedCount = reservedCount + :roomsCount, same guard in WHERE.
 *   4. INSERT booking (RESERVED), COMMIT.
 *
 * Two hypothetical modes, labelled as not the real code:
 *   "naive":   no lock, and the write sets reservedCount to the value read earlier + 1 (lost update).
 *   "guarded": no lock, but the real guarded UPDATE. PostgreSQL re-checks the WHERE after waiting,
 *              so the second UPDATE matches fewer rows. initBooking returns void, so nobody notices.
 *
 * PostgreSQL READ COMMITTED behaviour modelled: plain SELECTs never block and see committed data;
 * a locking SELECT or UPDATE waits for rows another transaction holds, then re-evaluates its WHERE
 * against the newly committed row version. Locks are released at COMMIT or ROLLBACK.
 */

import { availableOf, makeRows, type InventoryRow } from "./types";

export type TxId = "A" | "B";
export type RaceMode = "lock" | "naive" | "guarded";

export type OpKind = "begin" | "selectForUpdate" | "selectPlain" | "checkSize" | "updateGuarded" | "updateNaive" | "insertBooking" | "commit";

export const PROGRAMS: Record<RaceMode, readonly OpKind[]> = {
  lock: ["begin", "selectForUpdate", "checkSize", "updateGuarded", "insertBooking", "commit"],
  naive: ["begin", "selectPlain", "checkSize", "updateNaive", "insertBooking", "commit"],
  guarded: ["begin", "selectPlain", "checkSize", "updateGuarded", "insertBooking", "commit"],
};

export type TxPhase = "running" | "waiting" | "committed" | "rolledBack";

export interface TxState {
  id: TxId;
  pc: number;
  phase: TxPhase;
  /** Row indices the SELECT returned. */
  selected: number[] | null;
  /** reservedCount per row as read by the SELECT (the naive write reuses these). */
  readReserved: number[] | null;
  /** Uncommitted reservedCount per row index. */
  pending: Record<number, number>;
  updatedRows: number | null;
  bookingId: number | null;
  /** Set when the transaction must roll back on its next step. */
  failure: string | null;
  http: { status: number; body: string } | null;
}

export interface RaceEvent {
  seq: number;
  tx: TxId;
  op: OpKind | "wait" | "rollback";
  /** Short label for the lane. */
  title: string;
  /** The statement, in the code's own JPQL/SQL terms. */
  sql: string;
  detail: string;
  tone: "neutral" | "ok" | "wait" | "crit";
  /** Phase of each transaction right after this event, for drawing the lanes. */
  phases: Record<TxId, TxPhase>;
}

export interface RaceBooking {
  id: number;
  guest: TxId;
  /** Row indices this booking's UPDATE actually incremented. */
  rowsHeld: number[];
}

export interface RaceState {
  mode: RaceMode;
  roomsCount: number;
  daysCount: number;
  initialRows: InventoryRow[];
  rows: InventoryRow[];
  locks: (TxId | null)[];
  tx: Record<TxId, TxState>;
  bookings: RaceBooking[];
  events: RaceEvent[];
  turn: TxId;
  nextBookingId: number;
}

export interface RaceOptions {
  mode: RaceMode;
  /** Rooms left tonight (1 = the last room). The other nights have more. */
  roomsLeftTonight?: number;
  roomsCount?: number;
}

const TOTAL = 10;
/** Booked counts per night when 1 room is left tonight: 1, 3 and 2 rooms free. */
const BASE_BOOKED = [9, 7, 8];

export function initialRows(roomsLeftTonight = 1): InventoryRow[] {
  const booked = [...BASE_BOOKED];
  booked[0] = TOTAL - Math.max(1, Math.min(3, roomsLeftTonight));
  return makeRows([0, 1, 2], TOTAL, booked);
}

function newTx(id: TxId): TxState {
  return { id, pc: 0, phase: "running", selected: null, readReserved: null, pending: {}, updatedRows: null, bookingId: null, failure: null, http: null };
}

export function createRace(opts: RaceOptions): RaceState {
  const rows = initialRows(opts.roomsLeftTonight ?? 1);
  return {
    mode: opts.mode,
    roomsCount: opts.roomsCount ?? 1,
    daysCount: rows.length,
    initialRows: rows.map((r) => ({ ...r })),
    rows,
    locks: rows.map(() => null),
    tx: { A: newTx("A"), B: newTx("B") },
    bookings: [],
    events: [],
    turn: "A",
    nextBookingId: 101,
  };
}

const other = (id: TxId): TxId => (id === "A" ? "B" : "A");

export function isFinished(t: TxState): boolean {
  return t.phase === "committed" || t.phase === "rolledBack";
}

export function isDone(s: RaceState): boolean {
  return isFinished(s.tx.A) && isFinished(s.tx.B);
}

function clone(s: RaceState): RaceState {
  return structuredClone(s);
}

const WHERE_AVAIL = (n: number) => `(i.totalCount - i.bookedCount - i.reservedCount) >= ${n}`;
const RANGE = "i.room.id = :roomId AND i.date BETWEEN :checkInDate AND :checkOutDate AND i.closed = false";

function emit(s: RaceState, e: Omit<RaceEvent, "seq" | "phases">): void {
  s.events.push({ ...e, seq: s.events.length + 1, phases: { A: s.tx.A.phase, B: s.tx.B.phase } });
}

function lockedByOther(s: RaceState, id: TxId, rows: number[]): boolean {
  return rows.some((i) => s.locks[i] === other(id));
}

function rangeRows(s: RaceState): number[] {
  return s.rows.map((_, i) => i).filter((i) => !s.rows[i].closed);
}

function rowName(s: RaceState, i: number): string {
  return s.rows[i].date;
}

type StepResult = { kind: "progress"; state: RaceState } | { kind: "blocked"; holder: TxId } | { kind: "finished" };

/** Run the next operation of one transaction, or report that it must wait. Pure. */
export function stepTx(state: RaceState, id: TxId): StepResult {
  const t0 = state.tx[id];
  if (isFinished(t0)) return { kind: "finished" };
  const s = clone(state);
  const t = s.tx[id];
  const n = s.roomsCount;
  const wasWaiting = t.phase === "waiting";

  if (t.failure) {
    for (let i = 0; i < s.locks.length; i++) if (s.locks[i] === id) s.locks[i] = null;
    t.pending = {};
    t.phase = "rolledBack";
    t.http = { status: 500, body: t.failure };
    emit(s, {
      tx: id,
      op: "rollback",
      title: "ROLLBACK · HTTP 500",
      sql: "ROLLBACK",
      detail: `GlobalExceptionHandler's catch-all answers 500 with "${t.failure}". Guest ${id} sees an error and no booking.`,
      tone: "crit",
    });
    return { kind: "progress", state: s };
  }

  const op = PROGRAMS[s.mode][t.pc];
  switch (op) {
    case "begin": {
      emit(s, { tx: id, op, title: "BEGIN", sql: "BEGIN; -- @Transactional initialiseBooking", detail: `Guest ${id} clicks Book. POST /api/v1/bookings/init starts a transaction.`, tone: "neutral" });
      break;
    }
    case "selectForUpdate": {
      const range = rangeRows(s);
      if (lockedByOther(s, id, range)) return { kind: "blocked", holder: other(id) };
      const matched = range.filter((i) => availableOf(s.rows[i]) >= n);
      for (const i of matched) s.locks[i] = id;
      t.selected = matched;
      const sql = `SELECT i FROM Inventory i WHERE ${RANGE} AND ${WHERE_AVAIL(n)} -- @Lock(PESSIMISTIC_WRITE): FOR UPDATE`;
      if (wasWaiting) {
        const dropped = range.filter((i) => !matched.includes(i)).map((i) => rowName(s, i));
        emit(s, {
          tx: id,
          op,
          title: `Lock granted · ${matched.length} of ${s.daysCount} rows`,
          sql,
          detail: dropped.length
            ? `${other(id)} committed. PostgreSQL re-checks the WHERE on the new row versions: ${dropped.join(", ")} now has 0 available, so only ${matched.length} rows come back.`
            : `${other(id)} committed. The re-checked WHERE still matches all ${matched.length} rows.`,
          tone: dropped.length ? "crit" : "ok",
        });
      } else {
        emit(s, {
          tx: id,
          op,
          title: `SELECT … FOR UPDATE · ${matched.length} rows locked`,
          sql,
          detail: `findAndLockAvailableInventory returns ${matched.length} rows and locks them until ${id} commits.`,
          tone: "ok",
        });
      }
      break;
    }
    case "selectPlain": {
      const range = rangeRows(s);
      const matched = range.filter((i) => availableOf(s.rows[i]) >= n);
      t.selected = matched;
      t.readReserved = s.rows.map((r) => r.reservedCount);
      emit(s, {
        tx: id,
        op,
        title: `SELECT (no lock) · ${matched.length} rows`,
        sql: `SELECT i FROM Inventory i WHERE ${RANGE} AND ${WHERE_AVAIL(n)} -- no lock`,
        detail: `${id} reads committed data. ${rowName(s, 0)} shows reservedCount ${s.rows[0].reservedCount}, so ${availableOf(s.rows[0])} available. Nothing stops the other guest reading the same.`,
        tone: "neutral",
      });
      break;
    }
    case "checkSize": {
      const got = t.selected?.length ?? 0;
      if (got !== s.daysCount) {
        t.failure = "Room is not available anymore!";
        emit(s, {
          tx: id,
          op,
          title: `size ${got} ≠ ${s.daysCount} · throw`,
          sql: "if (inventoryList.size() != daysCount) throw new IllegalStateException(\"Room is not available anymore!\");",
          detail: `daysCount = DAYS.between(checkIn, checkOut) + 1 = ${s.daysCount}. Only ${got} rows came back.`,
          tone: "crit",
        });
      } else {
        emit(s, {
          tx: id,
          op,
          title: `size ${got} = ${s.daysCount} · ok`,
          sql: "if (inventoryList.size() != daysCount) throw ...",
          detail: `Every night of the stay has a row with space (DAYS.between + 1 = ${s.daysCount}).`,
          tone: "neutral",
        });
      }
      break;
    }
    case "updateGuarded": {
      const range = rangeRows(s);
      if (lockedByOther(s, id, range)) return { kind: "blocked", holder: other(id) };
      const visible = (i: number) => t.pending[i] ?? s.rows[i].reservedCount;
      const hit = range.filter((i) => s.rows[i].totalCount - s.rows[i].bookedCount - visible(i) >= n);
      for (const i of hit) {
        t.pending[i] = visible(i) + n;
        s.locks[i] = id;
      }
      t.updatedRows = hit.length;
      const missed = range.filter((i) => !hit.includes(i)).map((i) => rowName(s, i));
      emit(s, {
        tx: id,
        op,
        title: `UPDATE reservedCount + ${n} · ${hit.length} rows`,
        sql: `UPDATE Inventory i SET i.reservedCount = i.reservedCount + ${n} WHERE ${RANGE} AND ${WHERE_AVAIL(n)}`,
        detail: missed.length
          ? `${wasWaiting ? `${other(id)} committed, so the WHERE is re-checked. ` : ""}${missed.join(", ")} fails the guard, so ${hit.length} of ${s.daysCount} rows change. initBooking returns void: the count is never checked.`
          : `initBooking holds the rooms: reservedCount + ${n} on ${hit.length} rows (uncommitted).`,
        tone: missed.length ? "crit" : "neutral",
      });
      break;
    }
    case "updateNaive": {
      const rows = t.selected ?? [];
      if (lockedByOther(s, id, rows)) return { kind: "blocked", holder: other(id) };
      const lost: string[] = [];
      for (const i of rows) {
        const read = t.readReserved?.[i] ?? 0;
        if (s.rows[i].reservedCount !== read) lost.push(rowName(s, i));
        t.pending[i] = read + n;
        s.locks[i] = id;
      }
      t.updatedRows = rows.length;
      emit(s, {
        tx: id,
        op,
        title: lost.length ? `UPDATE reservedCount = ${(t.readReserved?.[0] ?? 0) + n} · lost update` : `UPDATE reservedCount = ${(t.readReserved?.[0] ?? 0) + n}`,
        sql: `UPDATE inventory SET reserved_count = :valueReadEarlier + ${n} WHERE id IN (:rowsRead) -- hypothetical`,
        detail: lost.length
          ? `${id} writes the value it read before ${other(id)} committed. ${other(id)}'s +${n} on ${lost.join(", ")} is overwritten.`
          : `${id} writes reservedCount = value read + ${n} on ${rows.length} rows (uncommitted).`,
        tone: lost.length ? "crit" : "neutral",
      });
      break;
    }
    case "insertBooking": {
      t.bookingId = s.nextBookingId++;
      emit(s, {
        tx: id,
        op,
        title: `INSERT booking ${t.bookingId} RESERVED`,
        sql: `INSERT INTO booking (room_id, check_in_date, check_out_date, rooms_count, booking_status, amount, ...) VALUES (..., ${n}, 'RESERVED', ...)`,
        detail: "calculateTotalPrice prices the locked rows, then the booking is saved as RESERVED.",
        tone: "neutral",
      });
      break;
    }
    case "commit": {
      const held: number[] = [];
      for (const [k, v] of Object.entries(t.pending)) {
        const i = Number(k);
        s.rows[i].reservedCount = v;
        held.push(i);
      }
      t.pending = {};
      for (let i = 0; i < s.locks.length; i++) if (s.locks[i] === id) s.locks[i] = null;
      t.phase = "committed";
      t.http = { status: 200, body: `BookingDTO { id: ${t.bookingId}, bookingStatus: RESERVED }` };
      if (t.bookingId !== null) s.bookings.push({ id: t.bookingId, guest: id, rowsHeld: held.sort((a, b) => a - b) });
      const waiter = s.tx[other(id)].phase === "waiting";
      emit(s, {
        tx: id,
        op,
        title: "COMMIT · HTTP 200",
        sql: "COMMIT",
        detail: `Booking ${t.bookingId} is RESERVED for guest ${id}.${waiter ? ` Row locks released, so ${other(id)} wakes up.` : ""}`,
        tone: "ok",
      });
      t.pc++;
      return { kind: "progress", state: s };
    }
  }
  t.pc++;
  if (t.phase === "waiting") t.phase = "running";
  // phase may have been "waiting" when emitted above; refresh the snapshot on the last event.
  s.events[s.events.length - 1].phases = { A: s.tx.A.phase, B: s.tx.B.phase };
  return { kind: "progress", state: s };
}

/**
 * Advance the shown schedule by one event: the transactions take turns, a transaction that has to
 * wait records one "waiting" event and then lets the other run.
 */
export function step(state: RaceState): RaceState {
  if (isDone(state)) return state;
  for (const id of [state.turn, other(state.turn)]) {
    const t = state.tx[id];
    if (isFinished(t)) continue;
    const r = stepTx(state, id);
    if (r.kind === "progress") return { ...r.state, turn: other(id) };
    if (r.kind === "blocked" && t.phase !== "waiting") {
      const s = clone(state);
      s.tx[id].phase = "waiting";
      const op = PROGRAMS[s.mode][t.pc];
      emit(s, {
        tx: id,
        op: "wait",
        title: `waits for ${r.holder}'s row lock`,
        sql:
          op === "selectForUpdate"
            ? `SELECT ... FOR UPDATE -- blocked: ${r.holder} holds the lock on ${rowName(s, 0)}`
            : `UPDATE ... -- blocked: ${r.holder} holds the row lock from its own uncommitted UPDATE`,
        detail: `${id} cannot read-to-write these rows until ${r.holder} commits or rolls back.`,
        tone: "wait",
      });
      s.turn = other(id);
      return s;
    }
  }
  return state;
}

/** Run the shown schedule to the end. */
export function runToEnd(state: RaceState, maxSteps = 100): RaceState {
  let s = state;
  for (let i = 0; i < maxSteps && !isDone(s); i++) {
    const next = step(s);
    if (next === s) break;
    s = next;
  }
  return s;
}

export interface RaceOutcome {
  bookings: number;
  /** Rooms that were free on the tightest night when the race started. */
  capacity: number;
  overbooked: boolean;
  /** reservedCount on every row equals the holds the bookings actually placed there. */
  countsMatchBookings: boolean;
  /** Bookings whose UPDATE missed some nights (the "guarded" mode). */
  partialBookings: number[];
  /** Per night: bookings that claim it vs. rooms that were free. */
  nights: { date: string; claimed: number; free: number; reservedCount: number }[];
}

export function outcome(s: RaceState): RaceOutcome {
  const n = s.roomsCount;
  const nights = s.rows.map((r, i) => {
    const free = availableOf(s.initialRows[i]);
    // Every booking covers checkInDate..checkOutDate, whatever its UPDATE managed to change.
    return { date: r.date, claimed: s.bookings.length * n, free, reservedCount: r.reservedCount };
  });
  const capacity = Math.min(...s.initialRows.map((r) => availableOf(r)));
  const overbooked = nights.some((x) => x.claimed > x.free) || s.rows.some((r) => r.bookedCount + r.reservedCount > r.totalCount);
  const countsMatchBookings = s.rows.every((r, i) => r.reservedCount - s.initialRows[i].reservedCount === s.bookings.length * n);
  const partialBookings = s.bookings.filter((b) => b.rowsHeld.length < s.daysCount).map((b) => b.id);
  return { bookings: s.bookings.length, capacity, overbooked, countsMatchBookings, partialBookings, nights };
}

/**
 * Every possible interleaving of the two transactions (respecting lock waits), as final states.
 * Used by the tests to show the lock holds in all schedules, not just the one on screen.
 */
export function allFinalStates(start: RaceState, limit = 10000): RaceState[] {
  const out: RaceState[] = [];
  const walk = (s: RaceState) => {
    if (out.length >= limit) return;
    if (isDone(s)) {
      out.push(s);
      return;
    }
    let moved = false;
    for (const id of ["A", "B"] as TxId[]) {
      const r = stepTx(s, id);
      if (r.kind === "progress") {
        moved = true;
        walk(r.state);
      }
    }
    if (!moved) throw new Error("Deadlock in race model");
  };
  walk(start);
  return out;
}
