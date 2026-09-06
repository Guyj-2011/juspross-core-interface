import { useJuspross } from "@/lib/juspross/store";
import type { Short, ShortStage } from "@/lib/juspross/types";
import { cn } from "@/lib/utils";

const STAGES: ShortStage[] = [
  "IDEA",
  "INVESTIGACION",
  "CURACION",
  "GUION",
  "PRODUCCION",
  "REVISION",
  "APROBACION",
  "PUBLICADO",
];

function StageTrack({ stage }: { stage: ShortStage }) {
  const idx = STAGES.indexOf(stage);
  return (
    <div className="mt-1.5 flex items-center gap-[3px]">
      {STAGES.map((s, i) => (
        <span
          key={s}
          title={s}
          className={cn(
            "h-[3px] flex-1 rounded-full transition-colors",
            i < idx
              ? "bg-cyan/60"
              : i === idx
                ? "bg-yellow animate-blip shadow-[0_0_8px_var(--yellow),0_0_16px_var(--yellow)]"
                : "bg-border",
          )}
        />
      ))}
    </div>
  );
}

function Thumb({ short }: { short: Short }) {
  return (
    <div
      className="relative h-14 w-10 shrink-0 overflow-hidden rounded-[2px] border border-border/70"
      style={{
        background: `linear-gradient(150deg, hsl(${short.hue} 90% 55% / 0.55), hsl(${short.hue + 24} 80% 18% / 0.9))`,
      }}
    >
      <span className="absolute inset-x-0 top-0 h-px animate-sweep bg-cyan/70" />
    </div>
  );
}

export function ShortsPanel() {
  const shorts = useJuspross((s) => s.shorts);
  const setReview = useJuspross((s) => s.setReviewShort);

  return (
    <ul className="space-y-2">
      {shorts.map((s) => (
        <li key={s.id} className="flex gap-2.5 rounded-sm border border-border/60 bg-background/25 p-2">
          <Thumb short={s} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-foreground/90">{s.title}</p>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-muted-foreground">
              <span>{s.stage}</span>
              <span>·</span>
              <span>{s.durationSec}s</span>
              <span>·</span>
              <span>{new Date(s.createdAt).toLocaleDateString("es-MX")}</span>
              {s.views !== undefined && s.views > 0 && (
                <>
                  <span>·</span>
                  <span className="text-cyan/80">{s.views.toLocaleString("es-MX")} views</span>
                </>
              )}
            </div>
            <StageTrack stage={s.stage} />
            {(s.stage === "REVISION" || s.stage === "APROBACION") && (
              <button
                onClick={() => setReview(s.id)}
                className="mt-1.5 rounded-sm border border-yellow/50 px-2 py-0.5 font-mono text-[9px] tracking-[0.2em] glow-yellow transition-colors hover:bg-yellow/10"
              >
                REVISAR
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}