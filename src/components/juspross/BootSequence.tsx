import { useEffect, useState } from "react";
import { useJuspross } from "@/lib/juspross/store";
import { cue } from "@/lib/juspross/audio";

const LINES = [
  "INICIANDO NÚCLEO JUSPROSS",
  "CARGANDO MALLA DE PARTÍCULAS",
  "SINCRONIZANDO AGENTES AUTÓNOMOS",
  "CALIBRANDO CANAL DE VOZ",
  "ENLACE OPERATIVO ESTABLECIDO",
];

export function BootSequence() {
  const booted = useJuspross((s) => s.booted);
  const setBooted = useJuspross((s) => s.setBooted);
  const sound = useJuspross((s) => s.soundEnabled);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (booted) return;
    const t = window.setInterval(() => {
      setStep((s) => {
        if (s >= LINES.length - 1) {
          window.clearInterval(t);
          window.setTimeout(() => {
            cue("activate", sound);
            setBooted(true);
          }, 620);
        }
        return s + 1;
      });
    }, 420);
    return () => window.clearInterval(t);
  }, [booted, setBooted, sound]);

  if (booted) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="scan-line w-[min(420px,80vw)] space-y-1.5">
        {LINES.slice(0, step + 1).map((l, i) => (
          <p key={l} className="font-mono text-[11px] tracking-[0.24em] text-cyan/85">
            <span className="text-muted-foreground">{String(i + 1).padStart(2, "0")}</span> {l}
            <span className="text-emerald"> {i < step ? "OK" : "…"}</span>
          </p>
        ))}
      </div>
      <div className="mt-6 h-px w-[min(420px,80vw)] bg-border">
        <span
          className="block h-px bg-cyan transition-[width] duration-500"
          style={{ width: `${((step + 1) / LINES.length) * 100}%` }}
        />
      </div>
    </div>
  );
}