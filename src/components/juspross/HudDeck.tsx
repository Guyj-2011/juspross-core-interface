import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useJuspross } from "@/lib/juspross/store";
import { ActivityPanel } from "./panels/ActivityPanel";
import { AgentsPanel } from "./panels/AgentsPanel";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------- */
/* Tarjeta HUD base                                                */
/* -------------------------------------------------------------- */
function Card({
  title,
  className,
  onClose,
  children,
}: {
  title: string;
  className?: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("holo pointer-events-auto absolute z-20 animate-rise rounded-md", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-cyan shadow-[0_0_10px_var(--cyan)]" />
          <h2 className="font-mono text-[10px] tracking-[0.24em] text-foreground/85 uppercase">
            {title}
          </h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label={`Cerrar ${title}`}
            className="text-muted-foreground transition-colors hover:text-cyan"
          >
            <X className="size-3.5" />
          </button>
        )}
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------- */
/* Estado del sistema (abajo izquierda) con sparklines             */
/* -------------------------------------------------------------- */
const METRICS = [
  { label: "CPU", color: "var(--cyan)", base: 24 },
  { label: "MEMORIA", color: "var(--magenta)", base: 61 },
  { label: "RED", color: "var(--amber)", base: 92 },
  { label: "GPU", color: "var(--destructive)", base: 37 },
];

function Spark({ color, seed }: { color: string; seed: number }) {
  const [pts, setPts] = useState<number[]>(() =>
    Array.from({ length: 30 }, (_, i) => 50 + Math.sin(i * seed) * 30),
  );
  useEffect(() => {
    const t = setInterval(
      () => setPts((p) => [...p.slice(1), 20 + Math.random() * 70]),
      900,
    );
    return () => clearInterval(t);
  }, []);
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * 96},${28 - (v / 100) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 96 28" className="h-6 w-24">
      <polyline points={d} fill="none" stroke={color} strokeWidth="1" />
    </svg>
  );
}

function SystemStatusCard() {
  return (
    <Card title="ESTADO DEL SISTEMA" className="bottom-5 left-5 w-[280px]">
      <div className="space-y-1.5">
        {METRICS.map((m, i) => (
          <div key={m.label} className="flex items-center gap-2">
            <span className="label-xs w-16">{m.label}</span>
            <span className="w-9 text-right font-mono text-[11px] text-foreground/85">
              {m.base}%
            </span>
            <Spark color={m.color} seed={i + 1} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- */
/* Estadísticas 28 días (derecha)                                  */
/* -------------------------------------------------------------- */
const STATS = [
  { label: "VIEWS", value: "312.4K", delta: "+18.2%" },
  { label: "LIKES", value: "41.7K", delta: "+9.4%" },
  { label: "SUSCRIPTORES", value: "6.208", delta: "+2.1%" },
  { label: "SHORTS PUBLICADOS", value: "24", delta: "+4" },
  { label: "RETENCIÓN PROM.", value: "58%", delta: "+3.0" },
  { label: "CTR PROM.", value: "7.1%", delta: "+0.4" },
];

function StatsCard({ onClose }: { onClose: () => void }) {
  const pts = Array.from({ length: 26 }, (_, i) => {
    const v = 18 + i * 1.6 + Math.sin(i * 1.3) * 6;
    return `${(i / 25) * 320},${60 - v * 0.75}`;
  }).join(" ");
  return (
    <Card
      title="ESTADÍSTICAS · 28 DÍAS"
      className="right-5 bottom-[27%] w-[380px]"
      onClose={onClose}
    >
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        {STATS.map((s) => (
          <div key={s.label}>
            <p className="label-xs truncate">{s.label}</p>
            <p className="mt-0.5 font-mono text-[17px] text-foreground">{s.value}</p>
            <p className="font-mono text-[9px] text-emerald">{s.delta}</p>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 320 62" className="mt-2 w-full">
        <defs>
          <linearGradient id="jpHudFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,62 ${pts} 320,62`} fill="url(#jpHudFill)" />
        <polyline points={pts} fill="none" stroke="var(--cyan)" strokeWidth="1.2" />
      </svg>
    </Card>
  );
}

/* -------------------------------------------------------------- */
/* Shorts en revisión (abajo derecha)                              */
/* -------------------------------------------------------------- */
function ShortsReviewCard({ onClose }: { onClose: () => void }) {
  const shorts = useJuspross((s) => s.shorts);
  const setStage = useJuspross((s) => s.setShortStage);
  const short = shorts.find((s) => s.stage === "REVISION" || s.stage === "APROBACION") ?? shorts[0];
  if (!short) return null;
  return (
    <Card title="SHORTS EN REVISIÓN" className="right-5 bottom-5 w-[360px]" onClose={onClose}>
      <div className="flex gap-3">
        <div
          className="relative h-[68px] w-[110px] shrink-0 overflow-hidden rounded-sm border border-border/70"
          style={{
            background: `linear-gradient(150deg, hsl(${short.hue} 80% 45% / 0.6), oklch(0.16 0.04 258))`,
          }}
        >
          <span className="absolute inset-x-0 top-0 h-px animate-sweep bg-cyan/70" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-foreground/95">{short.title}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {Math.floor(short.durationSec / 60)}.{String(short.durationSec % 60).padStart(2, "0")}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-amber">
            <span className="size-1.5 rounded-full bg-amber" />
            LISTO PARA REVISIÓN
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setStage(short.id, "IDEA")}
              className="rounded-sm border border-destructive/50 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-destructive transition-colors hover:bg-destructive/10"
            >
              RECHAZAR
            </button>
            <button
              onClick={() => setStage(short.id, "PUBLICADO")}
              className="rounded-sm border border-cyan/50 bg-cyan/10 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-cyan transition-colors hover:bg-cyan/20"
            >
              APROBAR
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- */
/* Deck completo                                                   */
/* -------------------------------------------------------------- */
export function HudDeck() {
  const [open, setOpen] = useState({ activity: true, agents: true, stats: true, shorts: true });

  return (
    <>
      {open.activity && (
        <Card
          title="ACTIVIDAD EN VIVO"
          className="top-[16%] left-[13%] w-[350px]"
          onClose={() => setOpen((o) => ({ ...o, activity: false }))}
        >
          <ActivityPanel />
        </Card>
      )}
      {open.agents && (
        <Card
          title="MAPA DE AGENTES"
          className="top-[17%] right-[16%] w-[310px]"
          onClose={() => setOpen((o) => ({ ...o, agents: false }))}
        >
          <AgentsPanel compact />
        </Card>
      )}
      {open.stats && <StatsCard onClose={() => setOpen((o) => ({ ...o, stats: false }))} />}
      {open.shorts && <ShortsReviewCard onClose={() => setOpen((o) => ({ ...o, shorts: false }))} />}
      <SystemStatusCard />
    </>
  );
}