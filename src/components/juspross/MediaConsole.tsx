import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Clock,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  KeyRound,
  Play,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { FREE_MODELS, IMAGE_PRESETS, VIDEO_DURATIONS, VIDEO_PRESETS } from "@/lib/juspross/agnes";
import { useMedia, type ChatMsg } from "@/lib/juspross/mediaStore";
import { cn } from "@/lib/utils";
import { useItemUrl } from "./useItemUrl";

const GOLD = "#ffd36b";

/** Pantalla IMA/VID: chat para describir imágenes o videos, ajustes de la clave de Agnes y botón del historial. */
export function MediaConsole() {
  const messages = useMedia((s) => s.messages);
  const busy = useMedia((s) => s.busy);
  const progress = useMedia((s) => s.progress);
  const workLabel = useMedia((s) => s.workLabel);
  const link = useMedia((s) => s.link);
  const kind = useMedia((s) => s.kind);
  const key = useMedia((s) => s.key);
  const create = useMedia((s) => s.create);
  const cancel = useMedia((s) => s.cancel);
  const setOpt = useMedia((s) => s.setOpt);
  const nItems = useMedia((s) => s.items.length);
  const historyOpen = useMedia((s) => s.historyOpen);
  const setHistoryOpen = useMedia((s) => s.setHistoryOpen);
  const settingsOpen = useMedia((s) => s.settingsOpen);
  const setSettingsOpen = useMedia((s) => s.setSettingsOpen);
  const [value, setValue] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!value.trim() || busy) return;
    void create(value);
    setValue("");
  };

  const badge =
    link === "ok"
      ? { t: "AGNES · CONECTADO", c: "#34d399" }
      : link === "checking"
        ? { t: "PROBANDO…", c: GOLD }
        : link === "error"
          ? { t: "CLAVE NO VÁLIDA", c: "#f87171" }
          : { t: "SIN CLAVE DE AGNES", c: "#9ca3af" };

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="absolute inset-x-0 top-4 flex flex-col items-center">
        <h1 className="text-[20px] font-light tracking-[0.5em] text-[#ffe9b0]/90">IMA / VID</h1>
        <p
          className="mt-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.3em]"
          style={{ color: busy ? GOLD : badge.c }}
        >
          <span
            className={cn("size-1.5 rounded-full", busy && "animate-pulse")}
            style={{
              background: busy ? GOLD : badge.c,
              boxShadow: `0 0 10px ${busy ? GOLD : badge.c}`,
            }}
          />
          {busy ? (workLabel || "TRABAJANDO").toUpperCase() : badge.t}
        </p>
      </div>

      <div className="pointer-events-auto absolute top-4 right-5 flex items-center gap-2">
        <button
          onClick={() => setHistoryOpen(!historyOpen)}
          className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 font-mono text-[10px] tracking-[0.2em] text-white/65 backdrop-blur-md transition-colors hover:text-white"
        >
          <Clock className="size-3.5" />
          HISTORIAL
          {nItems > 0 && (
            <span className="rounded-full bg-[#ffc83a]/20 px-1.5 text-[#ffd36b]">{nItems}</span>
          )}
        </button>
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-label="Conexión con Agnes"
          className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/65 backdrop-blur-md transition-colors hover:text-white"
        >
          {settingsOpen ? <X className="size-4" /> : <Settings2 className="size-4" />}
        </button>
        {settingsOpen && <Settings />}
      </div>

      <div className="absolute bottom-5 left-1/2 w-[min(760px,calc(100vw-300px))] min-w-[320px] -translate-x-1/2">
        {messages.length > 0 && (
          <div
            ref={logRef}
            className="pointer-events-auto mb-3 max-h-[32vh] space-y-2.5 overflow-y-auto pr-1 [mask-image:linear-gradient(to_bottom,transparent,black_12%)]"
          >
            {messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
          </div>
        )}

        {busy && (
          <div className="mb-2 h-[3px] overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#ff9d00] to-[#ffe27a] shadow-[0_0_12px_#ffc83a] transition-[width] duration-500"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}

        {!key && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="pointer-events-auto mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#ffc83a]/30 bg-[#ffc83a]/10 py-2 font-mono text-[10px] tracking-[0.2em] text-[#ffd36b] hover:bg-[#ffc83a]/15"
          >
            <KeyRound className="size-3.5" />
            CONECTA TU CLAVE DE AGNES PARA EMPEZAR
          </button>
        )}

        <div className="pointer-events-auto rounded-xl border border-[#ffc83a]/25 bg-black/75 px-3 py-2 backdrop-blur-md focus-within:shadow-[0_0_40px_-14px_#ffb800]">
          <div className="flex items-end gap-2">
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/10 self-center">
              {(
                [
                  ["image", "IMAGEN", ImageIcon],
                  ["video", "VIDEO", Film],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  disabled={busy}
                  onClick={() => setOpt({ kind: id })}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-2 font-mono text-[9.5px] tracking-[0.15em] transition-colors disabled:opacity-50",
                    kind === id
                      ? "bg-[#ffc83a]/20 text-[#ffd36b]"
                      : "text-white/45 hover:text-white",
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <textarea
              rows={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={
                kind === "image"
                  ? "Describe la imagen que quieres…"
                  : "Describe el video que quieres…"
              }
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-white placeholder:text-white/35 focus:outline-none"
            />
            {busy ? (
              <button
                onClick={cancel}
                aria-label="Cancelar"
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#ff3b4e]/15 text-[#ff6b7a] hover:bg-[#ff3b4e]/25"
              >
                <Square className="size-3.5" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!value.trim()}
                aria-label="Crear"
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-[#ffd36b] transition-colors hover:bg-[#ffc83a]/20 disabled:opacity-35"
              >
                <ArrowUp className="size-5" />
              </button>
            )}
          </div>
          <Options />
        </div>
        <p className="pointer-events-none mt-2 text-center font-mono text-[9px] tracking-[0.25em] text-white/30">
          ARRASTRA PARA GIRAR · RUEDA PARA ACERCAR
        </p>
      </div>
    </div>
  );
}

function Options() {
  const kind = useMedia((s) => s.kind);
  const busy = useMedia((s) => s.busy);
  const imagePreset = useMedia((s) => s.imagePreset);
  const videoPreset = useMedia((s) => s.videoPreset);
  const duration = useMedia((s) => s.duration);
  const polish = useMedia((s) => s.polish);
  const setOpt = useMedia((s) => s.setOpt);
  const sel =
    "rounded-md border border-white/10 bg-black/60 px-2 py-1 font-mono text-[10px] text-white/70 focus:outline-none disabled:opacity-50";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-white/5 pt-1.5">
      {kind === "image" ? (
        <select
          aria-label="Formato de la imagen"
          disabled={busy}
          value={imagePreset}
          onChange={(e) => setOpt({ imagePreset: e.target.value })}
          className={sel}
          style={{ colorScheme: "dark" }}
        >
          {IMAGE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      ) : (
        <>
          <select
            aria-label="Formato del video"
            disabled={busy}
            value={videoPreset}
            onChange={(e) => setOpt({ videoPreset: e.target.value })}
            className={sel}
            style={{ colorScheme: "dark" }}
          >
            {VIDEO_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Duración del video"
            disabled={busy}
            value={duration}
            onChange={(e) => setOpt({ duration: e.target.value })}
            className={sel}
            style={{ colorScheme: "dark" }}
          >
            {VIDEO_DURATIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </>
      )}
      <button
        disabled={busy}
        onClick={() => setOpt({ polish: !polish })}
        title="Usa el modelo de texto gratuito de Agnes para traducir y enriquecer tu descripción antes de crear (y para aplicar ajustes como «hazlo más oscuro»)."
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.1em] transition-colors disabled:opacity-50",
          polish ? "border-[#ffc83a]/40 text-[#ffd36b]" : "border-white/10 text-white/40",
        )}
      >
        <span
          className={cn(
            "flex size-3 items-center justify-center rounded-sm border",
            polish ? "border-[#ffc83a] bg-[#ffc83a]/30" : "border-white/30",
          )}
        >
          {polish && <Check className="size-2.5" />}
        </span>
        MEJORAR DESCRIPCIÓN
      </button>
      <span className="ml-auto font-mono text-[9px] tracking-[0.15em] text-white/25">
        MODELOS GRATIS
      </span>
    </div>
  );
}

function Bubble({ m }: { m: ChatMsg }) {
  const openWin = useMedia((s) => s.openWin);
  const item = useMedia((s) => s.items.find((i) => i.id === m.itemId));
  const url = useItemUrl(item);
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-white/75">
          {m.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "max-w-[88%] rounded-lg border px-3.5 py-2 text-[13px] leading-relaxed backdrop-blur-sm",
          m.error
            ? "border-red-500/40 bg-red-950/40 text-red-200"
            : "border-[#ffc83a]/25 bg-black/60 text-white/90",
        )}
      >
        <span className={cn(m.pending && "animate-pulse")}>{m.text}</span>
        {m.finalPrompt && !m.error && (
          <span
            className="mt-1 block text-[10.5px] leading-snug text-white/35"
            title="Descripción final enviada a Agnes"
          >
            {m.finalPrompt}
          </span>
        )}
        {item && (
          <button
            onClick={() => openWin(item.id)}
            className="mt-2 flex items-center gap-2.5 rounded-md border border-white/10 bg-white/5 p-1.5 pr-3 text-left transition-colors hover:border-[#ffc83a]/50"
          >
            <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
              {url &&
                (item.kind === "video" ? (
                  <video
                    src={`${url}#t=0.1`}
                    muted
                    preload="metadata"
                    className="size-full object-cover"
                  />
                ) : (
                  <img src={url} alt="" className="size-full object-cover" />
                ))}
              {item.kind === "video" && (
                <Play className="absolute size-4 text-white/90" fill="currentColor" />
              )}
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-[#ffd36b]">
              ABRIR EN VENTANA
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function Settings() {
  const savedKey = useMedia((s) => s.key);
  const link = useMedia((s) => s.link);
  const detail = useMedia((s) => s.linkDetail);
  const connect = useMedia((s) => s.connect);
  const disconnect = useMedia((s) => s.disconnect);
  const clearChat = useMedia((s) => s.clearChat);
  const [val, setVal] = useState("");
  const [show, setShow] = useState(false);
  const input =
    "w-full rounded-md border border-white/10 bg-black/60 px-2.5 py-1.5 pr-8 font-mono text-[11px] text-white placeholder:text-white/30 focus:border-[#ffc83a]/60 focus:outline-none";

  return (
    <div className="absolute top-11 right-0 w-[340px] space-y-3 rounded-xl border border-white/10 bg-black/90 p-4 text-white backdrop-blur-xl">
      <p className="font-mono text-[10px] tracking-[0.25em] text-[#ffd36b]">CONEXIÓN CON AGNES</p>
      <label className="block space-y-1">
        <span className="font-mono text-[9px] tracking-[0.2em] text-white/50">
          {savedKey ? "CLAVE GUARDADA (PEGA OTRA PARA CAMBIARLA)" : "TU CLAVE DE API"}
        </span>
        <span className="relative block">
          <input
            className={input}
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={savedKey ? "••••••••••••" : "Pega aquí tu clave"}
          />
          <button
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Ocultar clave" : "Mostrar clave"}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-white/45 hover:text-white"
          >
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </span>
      </label>
      <div className="flex items-center gap-2">
        <button
          disabled={!val.trim() || link === "checking"}
          onClick={() => {
            void connect(val);
            setVal("");
          }}
          className="flex-1 rounded-md border border-[#ffc83a]/50 bg-[#ffc83a]/15 py-1.5 font-mono text-[10px] tracking-[0.2em] text-[#ffd36b] hover:bg-[#ffc83a]/25 disabled:opacity-40"
        >
          CONECTAR
        </button>
        {savedKey && (
          <button
            onClick={disconnect}
            className="rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.15em] text-white/55 hover:text-red-300"
          >
            QUITAR
          </button>
        )}
        <button
          onClick={clearChat}
          aria-label="Borrar la conversación"
          title="Borrar la conversación"
          className="flex size-8 items-center justify-center rounded-md border border-white/10 text-white/55 hover:text-white"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {detail && (
        <p
          className={cn(
            "text-[11px] leading-snug",
            link === "ok"
              ? "text-emerald-300"
              : link === "error"
                ? "text-red-300"
                : "text-white/55",
          )}
        >
          {detail}
        </p>
      )}
      <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[10.5px] leading-relaxed text-white/55">
        <p className="font-mono text-[9px] tracking-[0.2em] text-white/70">
          SOLO MODELOS GRATUITOS
        </p>
        <p>
          Imágenes: <span className="text-white/80">{FREE_MODELS.image}</span>
          <br />
          Video: <span className="text-white/80">{FREE_MODELS.video}</span>
          <br />
          Texto (mejorar la descripción): <span className="text-white/80">{FREE_MODELS.text}</span>
        </p>
        <p>
          El plan gratis permite 1 video por minuto, así que si pides otro antes, la app espera
          sola. Tu clave se guarda solo en este navegador y pasa por el servidor de la app
          únicamente para reenviarla a Agnes.
        </p>
      </div>
    </div>
  );
}
