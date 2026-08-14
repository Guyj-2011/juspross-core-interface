import { useEffect, useState } from "react";
import { Cpu, RefreshCw, Square } from "lucide-react";
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
  const transcript = useJuspross((s) => s.transcript);
  const interim = useJuspross((s) => s.interim);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[22%] z-20 flex flex-col items-center gap-3">
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
  const state = useJuspross((s) => s.systemState);
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
    <div className="pointer-events-none absolute top-4 right-5 z-30 flex w-[214px] flex-col items-end gap-2">
      <div className="flex w-full items-center justify-end gap-3 font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
        <Cpu className="size-3.5" />
        <Square className="size-3.5" />
        <RefreshCw className="size-3.5" />
        <span className="text-foreground/85">{clock}</span>
      </div>
      <div className="holo w-full rounded-md px-3 py-2">
        <Row label="NÚCLEO" value={state === "error" ? "FALLO" : "ONLINE"} tone="text-cyan" dot />
        <Row
          label="N8N"
          value={
            connection === "online"
              ? "CONECTADO"
              : connection === "checking"
                ? "ENLACE"
                : connection === "offline"
                  ? "OFFLINE"
                  : "SIN CONFIG"
          }
          tone={connection === "online" ? "text-emerald" : "text-amber"}
          dot
        />
        <Row
          label="AGENTES"
          value={`${String(busy).padStart(2, "0")}/${String(agents.length).padStart(2, "0")}`}
          tone="text-foreground/85"
          dot
        />
        <Row label="LATENCIA" value="184ms" tone="text-cyan/80" dot />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  dot,
}: {
  label: string;
  value: string;
  tone: string;
  dot?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 py-[3px]">
      <span className="label-xs">{label}</span>
      <span className={cn("font-mono text-[10px] tracking-[0.18em]", tone)}>{value}</span>
      {dot && <span className={cn("size-1 rounded-full bg-current", tone)} />}
    </div>
  );
}