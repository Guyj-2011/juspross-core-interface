import { useJuspross } from "@/lib/juspross/store";
import type { Agent, AgentStatus } from "@/lib/juspross/types";
import { cn } from "@/lib/utils";

const TONE: Record<AgentStatus, string> = {
  IDLE: "text-muted-foreground",
  ACTIVE: "text-cyan",
  PROCESSING: "text-electric",
  COMPLETED: "text-emerald",
  ERROR: "text-amber",
};

const GLYPH: Record<string, string> = {
  planificador: "M4 4h16M4 12h10M4 20h6",
  director: "M12 3v18M4 8l8-5 8 5M4 16l8 5 8-5",
  investigador: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 21l-4.5-4.5",
  curador: "M4 6h16M7 12h10M10 18h4",
  guionista: "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4",
};

function Glyph({ id, className }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="none" strokeWidth={1.4}>
      <path d={GLYPH[id] ?? "M12 3l7 4v10l-7 4-7-4V7z"} stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/** Mapa neuronal del flujo real de agentes. */
function AgentMap({ agents }: { agents: Agent[] }) {
  const W = 340;
  const H = 150;
  const nodes = agents.map((a, i) => {
    const cols = Math.ceil(agents.length / 2);
    const row = i === 1 ? 1 : 0;
    const idx = i === 1 ? 0 : i > 1 ? i - 1 : i;
    const x = 34 + (idx % cols) * ((W - 68) / Math.max(1, cols - 1));
    const y = row === 1 ? H / 2 : i === 0 ? 26 : H - 26;
    return { ...a, x: i === 1 ? W / 2 : x, y };
  });
  const find = (id: string) => nodes.find((n) => n.id === id);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mb-3 w-full">
      {nodes.flatMap((n) =>
        n.links.map((l) => {
          const t = find(l);
          if (!t) return null;
          const live = n.status === "ACTIVE" || n.status === "PROCESSING";
          const d = `M${n.x} ${n.y} Q ${(n.x + t.x) / 2} ${(n.y + t.y) / 2 - 18} ${t.x} ${t.y}`;
          return (
            <g key={`${n.id}-${l}`}>
              <path d={d} stroke="var(--glass-edge)" strokeWidth={0.8} fill="none" />
              {live && (
                <circle r={2} fill="var(--cyan)">
                  <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
                </circle>
              )}
            </g>
          );
        }),
      )}
      {nodes.map((n) => (
        <g key={n.id}>
          <circle
            cx={n.x}
            cy={n.y}
            r={11}
            fill="oklch(0.16 0.04 258 / 0.9)"
            stroke={
              n.status === "IDLE"
                ? "var(--glass-edge)"
                : n.status === "COMPLETED"
                  ? "var(--emerald)"
                  : n.status === "ERROR"
                    ? "var(--amber)"
                    : "var(--cyan)"
            }
            strokeWidth={1}
          />
          <text
            x={n.x}
            y={n.y + 24}
            textAnchor="middle"
            className="fill-muted-foreground font-mono"
            style={{ fontSize: 7, letterSpacing: 1.4 }}
          >
            {n.name.slice(0, 4)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function AgentsPanel() {
  const agents = useJuspross((s) => s.agents);
  return (
    <div>
      <AgentMap agents={agents} />
      <ul className="space-y-1.5">
        {agents.map((a) => (
          <li key={a.id} className="rounded-sm border border-border/60 bg-background/25 px-2.5 py-2">
            <div className="flex items-center gap-2.5">
              <Glyph id={a.id} className={TONE[a.status]} />
              <span className="font-mono text-[11px] tracking-[0.18em] text-foreground/90">
                {a.name}
              </span>
              <span className={cn("ml-auto font-mono text-[9px] tracking-[0.2em]", TONE[a.status])}>
                {a.status}
              </span>
            </div>
            <p className="mt-1 pl-6.5 text-[11px] text-muted-foreground">{a.activity}</p>
          </li>
        ))}
      </ul>
      <p className="label-xs mt-3">ARQUITECTURA EXTENSIBLE · {agents.length} NODOS REGISTRADOS</p>
    </div>
  );
}