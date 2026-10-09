/**
 * NeonStays booking simulation: the public surface for the lab.
 * - race.ts: two transactions racing for the last room (row locks, re-checked WHERE, lost updates).
 * - service.ts: the booking state machine, Stripe Checkout and the webhook handler (current code vs fix).
 * - code.ts: file and line references into the real repository.
 */

export * from "./booking/types";
export * from "./booking/race";
export * from "./booking/service";
export * from "./booking/code";
