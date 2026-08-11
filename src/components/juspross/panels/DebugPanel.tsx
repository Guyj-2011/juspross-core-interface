import { useJuspross } from "@/lib/juspross/store";
import { cn } from "@/lib/utils";

export function DebugPanel() {
  const debug = useJuspross((s) => s.debug);
  const webhook = useJuspross((s) => s.webhookUrl);

  return (
    <div className="space-y-2 font-mono text-[10px]">
      <p className="label-xs">TRANSPORTE: {webhook ? "N8N" : "MOCK LOCAL"}</p>
      {debug.length === 0 && <p className="label-xs">SIN EVENTOS</p>}
      {debug
        .slice()
        .reverse()
        .map((e) => (
          <details key={e.id} className="rounded-sm border border-border/60 bg-background/30 px-2 py-1.5">
            <summary className="flex cursor-pointer items-center gap-2 select-none">
              <span className={cn(e.direction === "out" ? "text-electric" : "text-cyan")}>
                {e.direction === "out" ? "▶" : "◀"}
              </span>
              <span className="text-foreground/85">{e.label}</span>
              {e.ms !== undefined && <span className="text-muted-foreground">{e.ms}ms</span>}
              <span className="ml-auto text-muted-foreground/70">
                {new Date(e.time).toLocaleTimeString("es-MX", { hour12: false })}
              </span>
            </summary>
            <pre className="mt-1.5 overflow-x-auto text-[9px] leading-relaxed text-muted-foreground">
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          </details>
        ))}
    </div>
  );
}