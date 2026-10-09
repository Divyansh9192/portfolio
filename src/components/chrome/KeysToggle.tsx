"use client";

import { useKeysSetting } from "./preferences";

/** Turns the single-character shortcuts ("/" and "?") on or off. */
export function KeysToggle() {
  const [on, setOn] = useKeysSetting();
  const label = on ? "Key shortcuts: on" : "Key shortcuts: off";
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      className="w-fit text-left text-text-2 hover:text-text"
      aria-label={`${label}. Turn ${on ? "off" : "on"} the / and ? shortcuts`}
    >
      {label}
    </button>
  );
}
