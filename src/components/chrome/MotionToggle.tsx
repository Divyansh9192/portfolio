"use client";

import { useMotionSetting } from "./preferences";

const LABEL = { system: "Motion: system", reduce: "Motion: reduced", full: "Motion: full" } as const;
const NEXT = { system: "reduce", reduce: "full", full: "system" } as const;

/** Cycles the in-site motion override: system → reduced → full → system. */
export function MotionToggle() {
  const [motion, setMotion] = useMotionSetting();
  return (
    <button
      type="button"
      onClick={() => setMotion(NEXT[motion])}
      className="w-fit text-left text-text-2 hover:text-text"
      aria-label={`${LABEL[motion]}. Change motion preference`}
    >
      {LABEL[motion]}
    </button>
  );
}
