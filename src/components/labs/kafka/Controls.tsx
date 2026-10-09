import { useId } from "react";
import { Minus, Pause, Play, Plus, RotateCcw, SkipForward, Zap } from "lucide-react";
import type { EventKind, KafkaSnapshot, LatencyMode } from "@/lib/sim/kafka";
import { SIM, TOPICS } from "@/lib/sim/kafka";
import { cn } from "@/lib/cn";
import { ctl, fmtSeconds } from "./ui";

export interface ControlHandlers {
  publish: (kind: EventKind) => void;
  burst: () => void;
  scaleUp: () => void;
  scaleDown: () => void;
  crash2: () => void;
  setLatency: (m: LatencyMode) => void;
  togglePlay: () => void;
  setSpeed: (s: 1 | 4) => void;
  step: () => void;
  reset: () => void;
  toggleTraffic: () => void;
}

const LATENCY: { mode: LatencyMode; label: string; led: string; hint: string }[] = [
  { mode: "fast", label: "Fast", led: "text-ok", hint: `${SIM.feignMs.fast} ms per Feign call` },
  { mode: "slow", label: "Slow", led: "text-warn", hint: `${fmtSeconds(SIM.feignMs.slow)} per Feign call` },
  { mode: "down", label: "Down", led: "text-crit", hint: "Feign calls fail: connection refused" },
];

const KEY_LABEL: Record<string, string> = { postId: "key postId", senderId: "key senderId" };

const useUid = () => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (s: string) => `kafka-${s}-${uid}`;
};

function GroupLabel({ id, children, inline }: { id: string; children: string; inline: boolean }) {
  return (
    <span id={id} className={cn("font-mono text-[11px] uppercase tracking-[0.1em] text-text-3", inline && "shrink-0")}>
      {children}
    </span>
  );
}

/** Publish buttons, one per event class, plus a burst. */
export function PublishBar({ snap, on, compact }: { snap: KafkaSnapshot; on: ControlHandlers; compact: boolean }) {
  const id = useUid();
  const blocked = TOPICS.filter((t) => !snap.publish[t.kind].ok);
  return (
    <div role="group" aria-labelledby={id("publish")} className="flex flex-col gap-2" data-print="hide">
      <span id={id("publish")} className={cn("font-mono text-[11px] uppercase tracking-[0.1em] text-text-3", compact && "sr-only")}>
        Publish
      </span>
      <div
        className={cn(
          "grid gap-2",
          compact
            ? "grid-cols-2 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
            : "grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]",
        )}
      >
        {TOPICS.map((t) => {
          const can = snap.publish[t.kind];
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => on.publish(t.kind)}
              disabled={!can.ok}
              title={can.ok ? `${t.producerMethod} → ${t.name}, ${t.keyField ? KEY_LABEL[t.keyField] : "no key"}` : (can.reason ?? undefined)}
              className={cn(
                "flex min-h-10 min-w-0 flex-col items-start justify-center rounded-lg border border-line-strong bg-surface px-3 text-left transition-colors hover:border-text-3 hover:bg-surface-2",
                "disabled:pointer-events-none disabled:opacity-45",
                compact ? "py-1" : "py-2",
              )}
            >
              <span className="max-w-full truncate font-mono text-[12.5px] font-medium text-text">{t.eventClass}</span>
              {!compact ? (
                <>
                  <span className="max-w-full truncate font-mono text-[11px] text-text-2">{`{${t.fields.join(", ")}}`}</span>
                  <span className="max-w-full truncate font-mono text-[11px] text-text-3">
                    → {t.name} · {t.keyField ? KEY_LABEL[t.keyField] : "no key"}
                  </span>
                </>
              ) : null}
            </button>
          );
        })}
        <button type="button" onClick={on.burst} className={ctl(false, "font-mono")} title="10 PostCreatedEvent and 10 PostLikedEvent, interleaved">
          Burst ×20
        </button>
      </div>
      {blocked.length ? (
        <p className="text-[12px] text-text-3" aria-live="polite">
          {blocked.map((t) => `${t.eventClass}: ${snap.publish[t.kind].reason}`).join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/** Consumer instances (scale, crash) and the connections-service latency selector. */
export function GroupControls({ snap, on, compact }: { snap: KafkaSnapshot; on: ControlHandlers; compact: boolean }) {
  const id = useUid();
  const crash2Down = snap.instances.some((i) => i.n === 2 && i.state === "crashed");
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3" data-print="hide">
      <div role="group" aria-labelledby={id("instances")} className={cn("flex gap-1.5", compact ? "flex-row flex-wrap items-center gap-2" : "flex-col")}>
        <GroupLabel id={id("instances")} inline={compact}>
          {compact ? "Instances" : "notification-service instances"}
        </GroupLabel>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={on.scaleDown} disabled={!snap.canScaleDown} className={ctl(false, "w-10 px-0")} aria-label="Stop one instance gracefully">
            <Minus className="size-4" aria-hidden />
          </button>
          <output aria-live="polite" className="min-w-[4.5rem] text-center font-mono text-[13px] text-text tnum">
            {snap.runningCount} running
          </output>
          <button type="button" onClick={on.scaleUp} disabled={!snap.canScaleUp} className={ctl(false, "w-10 px-0")} aria-label="Start one more instance">
            <Plus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={on.crash2}
            disabled={!snap.canCrash2}
            className={ctl(false)}
            aria-describedby={!snap.canCrash2 ? id("crash-hint") : undefined}
            title={!snap.canCrash2 ? (crash2Down ? "Instance #2 is already down." : "Start a second instance first.") : "kill -9 instance #2"}
          >
            <Zap className="size-4" aria-hidden />
            Crash consumer 2
          </button>
          {!snap.canCrash2 ? (
            <span id={id("crash-hint")} className={cn("text-[11.5px] text-text-3", compact && "sr-only")}>
              {crash2Down ? "#2 is down" : "needs a 2nd instance"}
            </span>
          ) : null}
        </div>
      </div>

      <div className={cn("flex min-w-0", compact ? "flex-row flex-wrap items-center gap-2" : "flex-col gap-1.5")}>
        <GroupLabel id={id("latency-label")} inline={compact}>
          connections-service latency
        </GroupLabel>
        <div role="radiogroup" aria-labelledby={id("latency-label")} className="flex w-fit rounded-lg border border-line-strong p-0.5">
          {LATENCY.map((l) => (
            <label
              key={l.mode}
              title={l.hint}
              className={cn(
                "relative flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]",
                snap.latency === l.mode ? "bg-surface-2 text-text" : "text-text-2 hover:text-text",
              )}
            >
              <input type="radio" name={id("latency")} value={l.mode} checked={snap.latency === l.mode} onChange={() => on.setLatency(l.mode)} className="sr-only" />
              <span className={cn("led", l.led)} aria-hidden />
              {l.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Sim clock: play/pause (only when motion is allowed), step, speed, background traffic, reset. */
export function ClockControls({
  snap,
  on,
  motionOK,
  playing,
  speed,
}: {
  snap: KafkaSnapshot;
  on: ControlHandlers;
  motionOK: boolean;
  playing: boolean;
  speed: 1 | 4;
}) {
  return (
    <div role="group" aria-label="Simulation clock" className="flex flex-wrap items-center gap-2" data-print="hide">
      {motionOK ? (
        <button type="button" onClick={on.togglePlay} className={ctl(false, "min-w-[5.5rem]")} aria-pressed={playing}>
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {playing ? "Pause" : "Play"}
        </button>
      ) : null}
      <button type="button" onClick={on.step} disabled={motionOK && playing} className={ctl(false)} title="Advance 1 second of sim time">
        <SkipForward className="size-4" aria-hidden />
        Step 1 s
      </button>
      {motionOK ? (
        <div className="flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="Speed">
          {([1, 4] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => on.setSpeed(s)}
              className={cn("min-h-9 rounded-md px-3 font-mono text-[12.5px] transition-colors", speed === s ? "bg-surface-2 text-text" : "text-text-2 hover:text-text")}
            >
              {s}×
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" onClick={on.toggleTraffic} aria-pressed={snap.traffic} className={ctl(false)} title="Background posts and likes from the six users">
        <span className={cn("led", snap.traffic ? "text-async" : "text-text-3")} aria-hidden />
        Traffic {snap.traffic ? "on" : "off"}
      </button>
      <button type="button" onClick={on.reset} className={ctl(false, "w-10 px-0")} aria-label="Reset the simulation" title="Reset">
        <RotateCcw className="size-4" aria-hidden />
      </button>
    </div>
  );
}
