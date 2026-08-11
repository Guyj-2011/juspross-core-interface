import { useEffect, useState } from "react";
import { useJuspross } from "@/lib/juspross/store";
import { cn } from "@/lib/utils";

const STATE_TEXT: Record<string, { es: string; en: string; tone: string }> = {
  idle: { es: "EN ESPERA", en: "STANDBY", tone: "text-muted-foreground" },
  listening: { es: "ESCUCHANDO", en: "LISTENING", tone: "text-cyan" },
  thinking: { es: "RAZONANDO", en: "THINKING", tone: "text-cyan" },
  processing: { es: "AGENTES ACTIVOS", en: "PROCESSING", tone: "text-electric" },
  speaking: { es: "RESPONDIENDO", en: "SPEAKING", tone: "text-cyan" },
  success: { es: "COMPLETADO", en: "SUCCESS", tone: "text-emerald" },
  error: { es: "FALLO DEL SISTEMA", en: "ERROR", tone: "text-amber" },
};

export function StatusDeck() {
  const state = useJuspross((s) => s.systemState);
  const transcript = useJuspross((s) => s.transcript);
  const interim = useJuspross((s) => s.interim);
  const info = STATE_TEXT[state]!;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[16%] z-20 flex flex-col items-center gap-3">
      <div className="flex items-center gap-3">
        <span className={cn("size-1.5 rounded-full bg-current animate-blip", info.tone)} />
        <span className={cn("font-mono text-[11px] tracking-[0.5em]", info.tone)}>{info.en}</span>
        <span className="hairline h-px w-24" />
        <span className="label-xs">{info.es}</span>
      </div>
      {transcript && (
        <p
          className={cn(
            "holo max-w-2xl animate-rise rounded-sm px-4 py-2 text-center text-sm text-foreground/85",
            interim && "text-foreground/55 italic",
          )}
        >
          {transcript}
        </p>
      )}
    </div>
  );
}

export function Telemetry() {
  const connection = useJuspross((s) => s.connection);
  const agents = useJuspross((s) => s.agents);
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const t = setInterval(
      () => setClock(new Date().toLocaleTimeString("es-MX", { hour12: false })),
      1000,
    );
    return () => clearInterval(t);
  }, []);

  const busy = agents.filter((a) => a.status === "ACTIVE" || a.status === "PROCESSING").length;

  return (
    <div className="pointer-events-none absolute top-5 right-6 z-30 flex flex-col items-end gap-1.5 text-right">
      <div className="flex items-center gap-2">
        <span className="label-xs">NÚCLEO</span>
        <span className="font-mono text-[11px] tracking-[0.2em] text-cyan">ONLINE</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="label-xs">N8N</span>
        <span
          className={cn(
            "font-mono text-[11px] tracking-[0.2em]",
            connection === "online"
              ? "text-emerald"
              : connection === "checking"
                ? "text-cyan"
                : "text-amber",
          )}
        >
          {connection === "online"
            ? "CONNECTED"
            : connection === "checking"
              ? "HANDSHAKE"
              : connection === "offline"
                ? "OFFLINE"
                : "NO CONFIG"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="label-xs">AGENTES</span>
        <span className="font-mono text-[11px] tracking-[0.2em] text-foreground/75">
          {String(busy).padStart(2, "0")}/{String(agents.length).padStart(2, "0")}
        </span>
      </div>
      <span className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">{clock}</span>
    </div>
  );
}