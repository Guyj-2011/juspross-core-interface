import { useState } from "react";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  describeLocalResult,
  localAgentStatus,
  openSpotifyDesktop,
  pairLocalAgent,
  unpairLocalAgent,
} from "@/lib/juspross/localAgent";

export function LocalAgentPanel() {
  const [state, setState] = useState<{ running: boolean; paired: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState("");

  const refresh = async () => {
    const s = await localAgentStatus();
    setState({ running: s.running, paired: s.paired });
    if (!s.running && s.reason)
      setDetail(
        describeLocalResult({ ok: false, reason: s.reason }).replace("No pude abrir Spotify: ", ""),
      );
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setDetail("");
    try {
      await fn();
    } catch {
      setDetail(
        "No se pudo completar la operación con el equipo local. Revisa los permisos del navegador e inténtalo otra vez.",
      );
    } finally {
      setBusy(false);
    }
  };

  const pair = () =>
    run(async () => {
      const r = await pairLocalAgent(code);
      setCode("");
      const msg: Record<string, string> = {
        bad_code: "Código incorrecto.",
        code_expired: "El código caducó o ya se usó. Reinicia el agente para obtener otro.",
        pairing_locked: "Demasiados intentos. Reinicia el agente.",
      };
      setDetail(
        r.ok
          ? "Equipo emparejado correctamente."
          : (msg[r.reason] ?? describeLocalResult(r).replace("No pude abrir Spotify: ", "")),
      );
      await refresh();
    });

  const test = () =>
    run(async () => {
      const r = await openSpotifyDesktop();
      setDetail(describeLocalResult(r));
    });

  const unpair = () =>
    run(async () => {
      await unpairLocalAgent();
      setDetail("Este navegador quedó desconectado del agente local.");
      await refresh();
    });

  return (
    <section aria-label="Equipo local" className="space-y-2 border-t border-border/50 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Monitor className="size-3.5 text-cyan" />
            <span className="label-xs">EQUIPO LOCAL</span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {state === null
              ? "Sin comprobar"
              : state.paired
                ? "Agente conectado y emparejado"
                : state.running
                  ? "Agente detectado, sin emparejar"
                  : "Agente no detectado"}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(refresh)}>
          Comprobar
        </Button>
      </div>
      {state?.running && !state.paired && (
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="Código de 6 dígitos"
            aria-label="Código de emparejamiento"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background/40 px-2 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || code.length !== 6}
            onClick={() => void pair()}
          >
            Emparejar
          </Button>
        </div>
      )}
      {state?.paired && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void test()}>
            Abrir Spotify
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void unpair()}>
            Desconectar
          </Button>
        </div>
      )}
      {detail && (
        <p
          role="status"
          aria-live="polite"
          className="text-[10px] leading-relaxed text-muted-foreground"
        >
          {detail}
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Ejecuta <code>node juspross-agent.mjs</code> en tu PC con Windows. Solo puede abrir Spotify;
        no ejecuta otros programas.
      </p>
    </section>
  );
}
