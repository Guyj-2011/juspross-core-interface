import { useState } from "react";
import { Plus, Trash2, Workflow, X } from "lucide-react";
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
const NODE_COLOR: Record<string, string> = {
  planificador: "var(--amber)",
  director: "var(--cyan)",
  investigador: "var(--violet)",
  curador: "var(--emerald)",
  guionista: "var(--amber)",
};

function AgentMap({ agents }: { agents: Agent[] }) {
  const W = 340;
  const H = 210;
  const cx = W / 2;
  const cy = H / 2;
  const nodes = agents.map((a, i) => {
    if (agents.length <= 1) return { ...a, x: cx, y: cy };
    const ang = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
    return { ...a, x: cx + Math.cos(ang) * 118, y: cy + Math.sin(ang) * 68 };
  });
  const find = (id: string) => nodes.find((n) => n.id === id);
  const color = (id: string) => NODE_COLOR[id] ?? "var(--cyan)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mb-3 w-full">
      <defs>
        <radialGradient id="jp-map-core">
          <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
        </radialGradient>
        <marker id="jp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L8 4L0 8z" fill="var(--cyan)" opacity={0.7} />
        </marker>
      </defs>
      <circle cx={cx} cy={cy} r={92} fill="url(#jp-map-core)" />
      <ellipse
        cx={cx}
        cy={cy}
        rx={118}
        ry={68}
        fill="none"
        stroke="var(--glass-edge)"
        strokeWidth={0.6}
        strokeDasharray="3 5"
      />
      {nodes.flatMap((n) =>
        n.links.map((l) => {
          const t = find(l);
          if (!t) return null;
          const live = n.status === "ACTIVE" || n.status === "PROCESSING";
          const d = `M${n.x} ${n.y} Q ${(n.x + t.x) / 2} ${(n.y + t.y) / 2 - 18} ${t.x} ${t.y}`;
          return (
            <g key={`${n.id}-${l}`}>
              <path d={d} stroke="var(--glass-edge)" strokeWidth={0.8} fill="none" markerEnd="url(#jp-arrow)" />
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
          <circle cx={n.x} cy={n.y} r={19} fill={color(n.id)} opacity={0.1} />
          <circle
            cx={n.x}
            cy={n.y}
            r={14}
            fill="oklch(0.12 0.03 258 / 0.92)"
            stroke={color(n.id)}
            strokeWidth={1.2}
          />
          <path
            d={GLYPH[n.id] ?? "M12 3l7 4v10l-7 4-7-4V7z"}
            transform={`translate(${n.x - 7} ${n.y - 7}) scale(0.6)`}
            stroke={color(n.id)}
            strokeWidth={1.6}
            fill="none"
            strokeLinecap="round"
          />
          <text
            x={n.x}
            y={n.y + 26}
            textAnchor="middle"
            className="fill-muted-foreground font-mono"
            style={{ fontSize: 7.5, letterSpacing: 1 }}
          >
            {n.name.toUpperCase().slice(0, 14)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Selector de conexiones: chips de agentes a los que `excludeId` puede alimentar. */
function LinkPicker({
  agents,
  excludeId,
  selected,
  onToggle,
}: {
  agents: Agent[];
  excludeId?: string;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const options = agents.filter((a) => a.id !== excludeId);
  if (options.length === 0)
    return <p className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground">SIN OTROS NODOS DISPONIBLES</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((a) => {
        const on = selected.includes(a.id);
        return (
          <button
            type="button"
            key={a.id}
            onClick={() => onToggle(a.id)}
            className={cn(
              "flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] transition-colors",
              on
                ? "border-cyan/70 bg-cyan/15 text-cyan"
                : "border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className="inline-block size-1 rounded-full"
              style={{ background: NODE_COLOR[a.id] ?? "var(--cyan)" }}
            />
            {a.name}
          </button>
        );
      })}
    </div>
  );
}

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

export function AgentsPanel({ compact = false }: { compact?: boolean } = {}) {
  const agents = useJuspross((s) => s.agents);
  const addAgent = useJuspross((s) => s.addAgent);
  const removeAgent = useJuspross((s) => s.removeAgent);
  const updateAgent = useJuspross((s) => s.updateAgent);
  const [open, setOpen] = useState(false);
  const [editingLinksId, setEditingLinksId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [inputs, setInputs] = useState<string[]>([]);

  /** Conmuta la ENTRADA: el agente `sourceId` envía (o deja de enviar) a `targetId`. */
  const toggleInput = (sourceId: string, targetId: string) => {
    const src = agents.find((a) => a.id === sourceId);
    if (!src) return;
    updateAgent(sourceId, { links: toggle(src.links, targetId) });
  };

  const inputsOf = (id: string) => agents.filter((a) => a.links.includes(id)).map((a) => a.id);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    addAgent({ name, role, links, inputs });
    setName("");
    setRole("");
    setLinks([]);
    setInputs([]);
    setOpen(false);
  };

  return (
    <div>
      <AgentMap agents={agents} />
      {compact ? null : (
        <>
          <ul className="space-y-1.5">
            {agents.map((a) => (
              <li
                key={a.id}
                className="holo-bracket group relative overflow-hidden border border-border/60 bg-[linear-gradient(100deg,color-mix(in_oklab,var(--cyan)_7%,transparent),transparent_60%)] px-2.5 py-2"
              >
                <span
                  className="absolute inset-y-0 left-0 w-px"
                  style={{ background: NODE_COLOR[a.id] ?? "var(--cyan)" }}
                />
                <div className="flex items-center gap-2.5">
                  <Glyph id={a.id} className={TONE[a.status]} />
                  <span className="truncate font-mono text-[11px] tracking-[0.18em] text-foreground/90">
                    {a.name}
                  </span>
                  <span className={cn("ml-auto font-mono text-[9px] tracking-[0.2em]", TONE[a.status])}>
                    {a.status}
                  </span>
                  <button
                    onClick={() => setEditingLinksId(editingLinksId === a.id ? null : a.id)}
                    aria-label={`Editar conexiones de ${a.name}`}
                    title="Editar conexiones"
                    className={cn(
                      "rounded-sm p-0.5 transition-opacity hover:text-cyan",
                      editingLinksId === a.id
                        ? "text-cyan opacity-100"
                        : "text-muted-foreground opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <Workflow className="size-3" />
                  </button>
                  <button
                    onClick={() => removeAgent(a.id)}
                    aria-label={`Eliminar ${a.name}`}
                    className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-amber"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
                <p className="mt-1 pl-6.5 text-[11px] text-muted-foreground">{a.activity}</p>

                {editingLinksId === a.id ? (
                  <div className="mt-2 border border-cyan/25 bg-background/50 p-2 pl-2.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="label-xs text-cyan">ENVÍA SALIDA A →</p>
                      <button
                        onClick={() => setEditingLinksId(null)}
                        aria-label="Cerrar editor de conexiones"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                    <LinkPicker
                      agents={agents}
                      excludeId={a.id}
                      selected={a.links}
                      onToggle={(id) =>
                        updateAgent(a.id, { links: toggle(a.links, id) })
                      }
                    />
                    {a.links.length > 0 && (
                      <p className="mt-1.5 font-mono text-[9px] tracking-[0.12em] text-muted-foreground">
                        {a.name} →{" "}
                        {a.links
                          .map((l) => agents.find((x) => x.id === l)?.name)
                          .filter(Boolean)
                          .join(" → ")}
                      </p>
                    )}
                  </div>
                ) : (
                  a.links.length > 0 && (
                    <p className="mt-1 pl-6.5 font-mono text-[9px] tracking-[0.12em] text-cyan/60">
                      →{" "}
                      {a.links
                        .map((l) => agents.find((x) => x.id === l)?.name)
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )
                )}
              </li>
            ))}
          </ul>

          {open ? (
            <form
              onSubmit={submit}
              className="mt-3 space-y-2 border border-cyan/30 bg-background/40 p-2.5"
            >
              <p className="label-xs text-cyan">REGISTRAR NUEVO NODO</p>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="NOMBRE DEL AGENTE"
                className="w-full border border-border/60 bg-background/50 px-2 py-1.5 font-mono text-[11px] tracking-[0.14em] text-foreground outline-none focus:border-cyan"
              />
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Función / rol"
                className="w-full border border-border/60 bg-background/50 px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-cyan"
              />
              <div className="border border-border/50 bg-background/30 p-2">
                <p className="label-xs mb-1.5">FLUJO: ESTE AGENTE ENVÍA SU SALIDA A →</p>
                <LinkPicker
                  agents={agents}
                  selected={links}
                  onToggle={(id) => setLinks((l) => toggle(l, id))}
                />
                {links.length > 0 && (
                  <p className="mt-1.5 font-mono text-[9px] tracking-[0.12em] text-cyan/70">
                    {name.trim().toUpperCase() || "NUEVO"} →{" "}
                    {links
                      .map((l) => agents.find((x) => x.id === l)?.name)
                      .filter(Boolean)
                      .join(" → ")}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 border border-cyan/60 bg-cyan/10 py-1.5 font-mono text-[10px] tracking-[0.2em] text-cyan hover:bg-cyan/20"
                >
                  AÑADIR
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="border border-border/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-foreground"
                >
                  CANCELAR
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setOpen(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 border border-dashed border-cyan/40 py-2 font-mono text-[10px] tracking-[0.22em] text-cyan/80 transition-colors hover:border-cyan hover:bg-cyan/10 hover:text-cyan"
            >
              <Plus className="size-3.5" /> AÑADIR AGENTE
            </button>
          )}

          <p className="label-xs mt-3">ARQUITECTURA EXTENSIBLE · {agents.length} NODOS REGISTRADOS</p>
        </>
      )}
    </div>
  );
}
