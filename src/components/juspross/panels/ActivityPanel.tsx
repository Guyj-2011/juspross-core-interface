import { useEffect, useRef } from "react";
import { useJuspross } from "@/lib/juspross/store";
import { cn } from "@/lib/utils";

const TONE = {
  info: "text-foreground/75",
  warn: "glow-yellow",
  error: "glow-red",
  done: "text-emerald [text-shadow:0_0_8px_var(--emerald)]",
} as const;

const DOT = {
  info: "var(--cyan)",
  warn: "var(--yellow)",
  error: "var(--red)",
  done: "var(--emerald)",
} as const;

export function ActivityPanel() {
  const activity = useJuspross((s) => s.activity);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [activity.length]);

  return (
    <div className="font-mono text-[11px]">
      {activity.length === 0 && <p className="label-xs">SIN ACTIVIDAD REGISTRADA</p>}
      <ul className="space-y-1">
        {activity.map((e) => (
          <li key={e.id} className="grid grid-cols-[68px_92px_1fr] items-start gap-2">
            <span className="text-muted-foreground/70" suppressHydrationWarning>
              {new Date(e.time).toLocaleTimeString("es-MX", { hour12: false })}
            </span>
            <span className="flex items-center gap-1.5 tracking-[0.12em] text-cyan/80">
              <span
                className="size-1 rounded-full"
                style={{ background: DOT[e.level], boxShadow: `0 0 6px ${DOT[e.level]}, 0 0 12px ${DOT[e.level]}` }}
              />
              {e.agent}
            </span>
            <span className={cn(TONE[e.level])}>{e.message}</span>
          </li>
        ))}
      </ul>
      <div ref={endRef} />
    </div>
  );
}