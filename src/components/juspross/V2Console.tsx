import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Settings2, Square, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { testAi } from "@/lib/juspross/ai";
import { useV2Chat } from "@/lib/juspross/useV2Chat";
import { speechSupported } from "@/lib/juspross/useSpeech";
import { useV2 } from "@/lib/juspross/v2Store";
import { cn } from "@/lib/utils";

interface SRLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((e: {
        results: { length: number; [i: number]: { 0: { transcript: string }; isFinal: boolean } };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

const BLUE = "#6ea8ff";

export function V2Console() {
  const { send, stop } = useV2Chat();
  const messages = useV2((s) => s.messages);
  const state = useV2((s) => s.state);
  const link = useV2((s) => s.aiLink);
  const detail = useV2((s) => s.aiDetail);
  const voice = useV2((s) => s.voiceReplies);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const recRef = useRef<SRLike | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMicOk(speechSupported()), []);
  useEffect(() => () => recRef.current?.stop(), []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const busy = state === "thinking" || state === "speaking";

  const submit = () => {
    if (!value.trim()) return;
    void send(value);
    setValue("");
  };

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SRLike;
      webkitSpeechRecognition?: new () => SRLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "es-ES";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        txt += r[0].transcript;
        if (r.isFinal) finalText = txt;
      }
      setValue(txt);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (finalText.trim()) {
        void send(finalText, true);
        setValue("");
      }
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const linkLabel =
    link === "online"
      ? "QWEN CONECTADO"
      : link === "checking"
        ? "PROBANDO…"
        : link === "offline"
          ? "SIN CONEXIÓN · SIMULADO"
          : "IA SIMULADA";
  const linkColor = link === "online" ? "#34d399" : link === "offline" ? "#f87171" : BLUE;

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* cabecera */}
      <div className="absolute inset-x-0 top-4 flex flex-col items-center">
        <h1 className="font-light tracking-[0.5em] text-white/90 text-[22px]">JUSPROSS 2.0</h1>
        <p
          className="mt-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.3em]"
          style={{ color: linkColor }}
          title={detail}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: linkColor, boxShadow: `0 0 10px ${linkColor}` }}
          />
          {state === "thinking" ? "PENSANDO…" : state === "speaking" ? "RESPONDIENDO" : linkLabel}
        </p>
      </div>

      {/* ajustes */}
      <div className="pointer-events-auto absolute top-4 right-5">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Ajustes de la IA"
          className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/60 backdrop-blur-md transition-colors hover:text-white"
        >
          {open ? <X className="size-4" /> : <Settings2 className="size-4" />}
        </button>
        {open && <AiSettings onClose={() => setOpen(false)} />}
      </div>

      {/* conversación + entrada */}
      <div className="absolute bottom-5 left-1/2 w-[min(720px,calc(100vw-260px))] min-w-[300px] -translate-x-1/2">
        {messages.length > 0 && (
          <div
            ref={logRef}
            className="pointer-events-auto mb-3 max-h-[34vh] space-y-3 overflow-y-auto pr-1 [mask-image:linear-gradient(to_bottom,transparent,black_14%)]"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[88%] rounded-lg px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap backdrop-blur-sm",
                    m.role === "user"
                      ? "border border-white/10 bg-white/5 text-white/70"
                      : m.error
                        ? "border border-red-500/40 bg-red-950/40 text-red-200"
                        : "border border-[#3d7bff]/25 bg-black/55 text-white/90",
                  )}
                >
                  {m.text || <span className="animate-pulse text-white/40">…</span>}
                  {m.simulated && (
                    <span className="mt-1 block font-mono text-[9px] tracking-[0.2em] text-[#6ea8ff]/70">
                      RESPUESTA SIMULADA
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            "pointer-events-auto flex items-end gap-2 rounded-xl border bg-black/70 px-3 py-2 backdrop-blur-md transition-shadow",
            listening
              ? "border-[#ff3b4e]/60 shadow-[0_0_40px_-12px_#ff3b4e]"
              : "border-[#3d7bff]/30 focus-within:shadow-[0_0_40px_-14px_#3d7bff]",
          )}
        >
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
            placeholder={listening ? "Escuchando…" : "Escríbele a Juspross 2.0…"}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-white placeholder:text-white/35 focus:outline-none"
          />
          {micOk && (
            <button
              onClick={toggleMic}
              aria-label={listening ? "Detener micrófono" : "Hablar"}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
                listening ? "bg-[#ff3b4e]/20 text-[#ff6b7a]" : "text-white/55 hover:text-white",
              )}
            >
              <Mic className="size-4.5" strokeWidth={1.6} />
            </button>
          )}
          <button
            onClick={() => useV2.getState().setVoiceReplies(!voice)}
            aria-label={voice ? "Silenciar respuestas habladas" : "Leer respuestas en voz alta"}
            title={voice ? "Respuestas en voz alta: sí" : "Respuestas en voz alta: no"}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-white/55 transition-colors hover:text-white"
          >
            {voice ? (
              <Volume2 className="size-4.5" strokeWidth={1.6} />
            ) : (
              <VolumeX className="size-4.5" strokeWidth={1.6} />
            )}
          </button>
          {busy ? (
            <button
              onClick={stop}
              aria-label="Detener"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#ff3b4e]/15 text-[#ff6b7a] hover:bg-[#ff3b4e]/25"
            >
              <Square className="size-3.5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!value.trim()}
              aria-label="Enviar"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-[#6ea8ff] transition-colors hover:bg-[#3d7bff]/20 disabled:opacity-35"
            >
              <ArrowUp className="size-5" />
            </button>
          )}
        </div>
        <p className="pointer-events-none mt-2 text-center font-mono text-[9px] tracking-[0.25em] text-white/30">
          ARRASTRA PARA GIRAR EL NÚCLEO · RUEDA PARA ACERCAR
        </p>
      </div>
    </div>
  );
}

function AiSettings({ onClose }: { onClose: () => void }) {
  const endpoint = useV2((s) => s.aiEndpoint);
  const model = useV2((s) => s.aiModel);
  const link = useV2((s) => s.aiLink);
  const detail = useV2((s) => s.aiDetail);
  const [ep, setEp] = useState(endpoint);
  const [md, setMd] = useState(model);

  const test = async () => {
    const s = useV2.getState();
    s.setAi({ endpoint: ep, model: md });
    s.setLink("checking", "Probando conexión…");
    try {
      const m = await testAi(useV2.getState().aiEndpoint, useV2.getState().aiModel);
      useV2.getState().setLink("online", `Conectado · modelo: ${m}`);
    } catch (e) {
      useV2.getState().setLink("offline", e instanceof Error ? e.message : "No se pudo conectar.");
    }
  };

  const field =
    "w-full rounded-md border border-white/10 bg-black/60 px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-white/30 focus:border-[#3d7bff]/60 focus:outline-none";

  return (
    <div className="absolute top-11 right-0 w-[320px] space-y-3 rounded-xl border border-white/10 bg-black/85 p-4 text-white backdrop-blur-xl">
      <p className="font-mono text-[10px] tracking-[0.25em] text-[#6ea8ff]">
        IA LOCAL · QWEN VÍA OLLAMA
      </p>
      <label className="block space-y-1">
        <span className="font-mono text-[9px] tracking-[0.2em] text-white/50">
          DIRECCIÓN DE OLLAMA
        </span>
        <input
          className={field}
          value={ep}
          onChange={(e) => setEp(e.target.value)}
          placeholder="http://localhost:11434"
        />
      </label>
      <label className="block space-y-1">
        <span className="font-mono text-[9px] tracking-[0.2em] text-white/50">
          MODELO (vacío = detectar Qwen)
        </span>
        <input
          className={field}
          value={md}
          onChange={(e) => setMd(e.target.value)}
          placeholder="auto"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void test()}
          className="flex-1 rounded-md border border-[#3d7bff]/50 bg-[#3d7bff]/15 py-1.5 font-mono text-[10px] tracking-[0.2em] text-[#9cc0ff] hover:bg-[#3d7bff]/25"
        >
          PROBAR CONEXIÓN
        </button>
        <button
          onClick={() => {
            useV2.getState().clear();
            onClose();
          }}
          aria-label="Borrar conversación"
          title="Borrar conversación"
          className="flex size-8 items-center justify-center rounded-md border border-white/10 text-white/55 hover:text-white"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <p
        className={cn(
          "text-[11px] leading-snug",
          link === "online"
            ? "text-emerald-300"
            : link === "offline"
              ? "text-red-300"
              : "text-white/55",
        )}
      >
        {detail}
      </p>
    </div>
  );
}
