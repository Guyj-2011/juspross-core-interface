import { useEffect, useState } from "react";
import { useJuspross } from "@/lib/juspross/store";
import { useRuntime } from "@/lib/juspross/useRuntime";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Cloud, Music2, Sparkles, Waves } from "lucide-react";
import { LocalAgentPanel } from "@/components/juspross/LocalAgentPanel";

export function ConnectionPanel() {
  const webhookUrl = useJuspross((s) => s.webhookUrl);
  const setWebhookUrl = useJuspross((s) => s.setWebhookUrl);
  const connection = useJuspross((s) => s.connection);
  const { testConnection } = useRuntime();
  const [draft, setDraft] = useState(webhookUrl);
  const [detail, setDetail] = useState<string>("");

  return (
    <div className="space-y-3">
      <div>
        <label className="label-xs" htmlFor="jp-webhook">
          N8N WEBHOOK URL
        </label>
        <input
          id="jp-webhook"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setWebhookUrl(draft.trim())}
          placeholder="https://n8n.tu-dominio.com/webhook/juspross"
          className="mt-1 w-full rounded-sm border border-border bg-background/40 px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-cyan/60 focus:outline-none"
        />
      </div>
      <button
        onClick={async () => {
          setWebhookUrl(draft.trim());
          const res = await testConnection();
          setDetail(`${res.detail} · ${res.ms}ms`);
        }}
        className="w-full rounded-sm border border-cyan/40 py-1.5 font-mono text-[10px] tracking-[0.28em] text-cyan transition-colors hover:bg-cyan/10"
      >
        TEST CONNECTION
      </button>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-1.5 rounded-full",
            connection === "online" ? "bg-emerald" : connection === "checking" ? "bg-cyan animate-blip" : "bg-amber",
          )}
        />
        <span className="font-mono text-[10px] tracking-[0.24em] text-foreground/85">
          {connection === "online" ? "JUSPROSS CONNECTED" : connection === "checking" ? "HANDSHAKE…" : "JUSPROSS OFFLINE"}
        </span>
      </div>
      {detail && <p className="label-xs">{detail}</p>}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Sin webhook configurado, la interfaz opera con el runner local de demostración: emite
        exactamente los mismos eventos de agentes que enviará n8n.
      </p>
    </div>
  );
}


export function SpotifyConnectionPanel() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/spotify", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { configured?: boolean; connected?: boolean };
        if (active) setStatus({ configured: Boolean(payload.configured), connected: Boolean(payload.connected) });
      })
      .catch(() => {
        if (active) setDetail("No se pudo consultar la conexión con Spotify.");
      });
    const result = new URLSearchParams(window.location.search).get("spotify");
    if (result === "connected") setDetail("Spotify quedó conectado correctamente.");
    else if (result === "denied") setDetail("No se concedieron los permisos de Spotify.");
    else if (result === "token-error" || result === "state-error") setDetail("No se pudo completar la conexión. Inténtalo otra vez.");
    return () => { active = false; };
  }, []);

  const disconnect = async () => {
    setBusy(true);
    setDetail("");
    try {
      const response = await fetch("/api/spotify", { method: "POST" });
      if (!response.ok) throw new Error("No se pudo desconectar Spotify.");
      setStatus((current) => current ? { ...current, connected: false } : current);
      setDetail("Spotify se desconectó de Juspross.");
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "No se pudo desconectar Spotify.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-b border-border/50 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Music2 className="size-3.5 text-emerald-400" />
            <span className="label-xs">SPOTIFY</span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {status?.connected ? "Cuenta conectada" : status?.configured ? "Cuenta sin conectar" : "Integración pendiente de configurar"}
          </p>
        </div>
        {status?.connected ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void disconnect()}>
            {busy ? "..." : "Desconectar"}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!status?.configured || busy}
            onClick={() => window.location.assign("/api/spotify/connect")}
          >
            Conectar
          </Button>
        )}
      </div>
      {detail && <p className="text-[10px] leading-relaxed text-muted-foreground">{detail}</p>}
      {!status?.configured && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Faltan configurar los secretos de Spotify en el backend. No introduzcas claves en el chat ni en esta pantalla.
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Conecta tu cuenta para que Juspross pueda buscar canciones y controlar la reproducción. El agente local se encarga de abrir la aplicación de Windows.
      </p>
    </div>
  );
}


export function SettingsPanel() {
  const sound = useJuspross((s) => s.soundEnabled);
  const setSound = useJuspross((s) => s.setSound);
  const quality = useJuspross((s) => s.quality);
  const setQuality = useJuspross((s) => s.setQuality);
  const wake = useJuspross((s) => s.micEnabled);
  const setMic = useJuspross((s) => s.setMic);
  const auroraStyle = useJuspross((s) => s.auroraStyle);
  const setAuroraStyle = useJuspross((s) => s.setAuroraStyle);

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <span className="label-xs">{label}</span>
      {children}
    </div>
  );

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={cn(
        "h-4 w-9 rounded-full border transition-colors",
        on ? "border-cyan/60 bg-cyan/25" : "border-border bg-background/40",
      )}
    >
      <span
        className={cn(
          "block size-3 rounded-full bg-foreground/80 transition-transform",
          on ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );

  return (
    <div>
      <SpotifyConnectionPanel />
      <LocalAgentPanel />
      <Row label="ESCUCHA CONTINUA">
        <Toggle on={wake} onClick={() => setMic(!wake)} />
      </Row>
      <Row label="SONIDOS DEL SISTEMA">
        <Toggle on={sound} onClick={() => setSound(!sound)} />
      </Row>
      <div className="border-b border-border/50 py-3">
        <span className="label-xs" id="aurora-style-label">AURORAS BOREALES</span>
        <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-labelledby="aurora-style-label">
          {([
            { value: "canopy", label: "Bóveda total", Icon: Cloud },
            { value: "distributed", label: "Distribuida", Icon: Sparkles },
            { value: "depth", label: "En profundidad", Icon: Waves },
          ] as const).map(({ value, label, Icon }) => (
            <Button
              key={value}
              variant="outline"
              size="sm"
              aria-pressed={auroraStyle === value}
              onClick={() => setAuroraStyle(value)}
              className={cn(
                "h-11 gap-1.5 whitespace-normal rounded-sm px-1.5 font-mono text-[10px] leading-tight",
                auroraStyle === value
                  ? "border-cyan/60 bg-cyan/10 text-cyan hover:bg-cyan/15 hover:text-cyan"
                  : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />{label}
            </Button>
          ))}
        </div>
      </div>
      <Row label="CALIDAD DE RENDER">
        <div className="flex gap-1">
          {(["high", "balanced", "low"] as const).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={cn(
                "rounded-sm border px-2 py-0.5 font-mono text-[9px] tracking-[0.18em] transition-colors",
                quality === q
                  ? "border-cyan/50 bg-cyan/10 text-cyan"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {q.toUpperCase()}
            </button>
          ))}
        </div>
      </Row>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        La calidad baja reduce partículas del entorno y desactiva el suavizado, conservando el
        núcleo intacto.
      </p>
    </div>
  );
}