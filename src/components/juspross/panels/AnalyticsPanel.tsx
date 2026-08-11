import { ANALYTICS_SERIES } from "@/lib/juspross/seed";

const metrics = [
  { label: "VIEWS 28D", value: "312.4K", delta: "+18.2%" },
  { label: "LIKES", value: "41.7K", delta: "+9.4%" },
  { label: "SUBS", value: "6 208", delta: "+2.1%" },
  { label: "SHORTS", value: "24", delta: "+4" },
  { label: "RETENCIÓN", value: "58%", delta: "+3.0" },
  { label: "CTR", value: "7.1%", delta: "+0.4" },
];

export function AnalyticsPanel() {
  const max = Math.max(...ANALYTICS_SERIES.map((d) => d.views));
  const pts = ANALYTICS_SERIES.map((d, i) => {
    const x = (i / (ANALYTICS_SERIES.length - 1)) * 320;
    const y = 90 - (d.views / max) * 78;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-sm border border-border/60 bg-background/25 p-2">
            <p className="label-xs">{m.label}</p>
            <p className="mt-0.5 font-mono text-sm text-foreground">{m.value}</p>
            <p className="font-mono text-[9px] text-emerald">{m.delta}</p>
          </div>
        ))}
      </div>

      <div className="rounded-sm border border-border/60 bg-background/25 p-2">
        <p className="label-xs mb-1">FLUJO DE REPRODUCCIONES · 28 DÍAS</p>
        <svg viewBox="0 0 320 96" className="w-full">
          <defs>
            <linearGradient id="jpFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,96 ${pts} 320,96`} fill="url(#jpFill)" />
          <polyline points={pts} fill="none" stroke="var(--cyan)" strokeWidth="1.2" />
          {ANALYTICS_SERIES.map((d, i) => (
            <circle
              key={d.day}
              cx={(i / (ANALYTICS_SERIES.length - 1)) * 320}
              cy={90 - (d.views / max) * 78}
              r={0.9}
              fill="var(--cyan)"
            />
          ))}
        </svg>
      </div>

      <div className="rounded-sm border border-border/60 bg-background/25 p-2">
        <p className="label-xs mb-1.5">RETENCIÓN POR SHORT</p>
        <div className="flex h-16 items-end gap-[3px]">
          {ANALYTICS_SERIES.slice(-20).map((d) => (
            <span
              key={d.day}
              className="flex-1 rounded-t-[1px] bg-gradient-to-t from-electric/25 to-cyan/80"
              style={{ height: `${d.retention}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}