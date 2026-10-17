import { useEffect, useRef, useState } from "react";
import { ArrowUp, History, Mic, Settings2, Square, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { AiUnreachable, testAi } from "@/lib/juspross/ai";
import { useV2Chat } from "@/lib/juspross/useV2Chat";
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
        resultIndex: number;
        results: { length: number; [i: number]: { 0: { transcript: string }; isFinal: boolean } };
      }) => void)
    | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onstart: (() => void) | null;
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
  const aiEndpoint = useV2((s) => s.aiEndpoint);
  const aiModel = useV2((s) => s.aiModel);
  const autoConnect = useV2((s) => s.autoConnect);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [secretV3, setSecretV3] = useState(false);
  const recRef = useRef<SRLike | null>(null);
  const voiceSessionRef = useRef(false);
  const restartTimerRef = useRef<number | undefined>(undefined);
  const phraseTimerRef = useRef<number | undefined>(undefined);
  const pendingSpeechRef = useRef("");
  const voiceEndNoticeRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // After one successful, user-initiated connection, reconnect on every page open.
  // If Ollama starts later, keep retrying with backoff instead of silently giving up after 20 tries.
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempts = 0;
    const healthCheckMs = 15_000;

    if (!autoConnect) {
      useV2.getState().setLink(
        "simulated",
        "La conexión automática está desactivada temporalmente mientras se prueba la conexión.",
      );
      return;
    }

    const connect = async () => {
      if (cancelled) return;
      attempts += 1;
      const current = useV2.getState();
      const endpoint = current.aiEndpoint || "http://localhost:11434";
      const wantedModel = current.aiModel.trim() || "qwen3:8b";
      const wasOnline = current.aiLink === "online";

      // Keep the connected indicator steady during background health checks.
      if (!wasOnline) {
        current.setLink(
          "checking",
          attempts === 1
            ? "Conectando automáticamente con Qwen3 8B…"
            : `Esperando a Ollama… nuevo intento en curso (${attempts}).`,
        );
      }

      try {
        const resolvedModel = await testAi(endpoint, wantedModel);
        if (cancelled) return;
        attempts = 0;
        useV2.getState().setLink(
          "online",
          `Conexión automática establecida · ${resolvedModel}. Se comprobará en segundo plano y se reconectará si se interrumpe.`,
        );
        // Periodically detect server exits instead of assuming the first success lasts forever.
        retryTimer = window.setTimeout(() => void connect(), healthCheckMs);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "No se pudo conectar con Ollama.";
        const retrySeconds = Math.min(5 * attempts, 20);
        const retryMessage = error instanceof AiUnreachable
          ? "Se volverá a intentar automáticamente"
          : "Se volverá a comprobar automáticamente";
        useV2.getState().setLink(
          "offline",
          `${message} ${retryMessage} en ${retrySeconds} segundos.`,
        );
        // Retry any failure, including CORS/permissions or a temporarily missing model.
        retryTimer = window.setTimeout(() => void connect(), retrySeconds * 1000);
      }
    };

    void connect();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [aiEndpoint, aiModel, autoConnect]);

  useEffect(() => {
    const onSecretV3 = (event: Event) => {
      setSecretV3((event as CustomEvent<{ active: boolean }>).detail.active);
    };
    window.addEventListener("juspross:secret-v3", onSecretV3);
    return () => window.removeEventListener("juspross:secret-v3", onSecretV3);
  }, []);
  useEffect(
    () => () => {
      voiceSessionRef.current = false;
      if (restartTimerRef.current !== undefined) window.clearTimeout(restartTimerRef.current);
      if (phraseTimerRef.current !== undefined) window.clearTimeout(phraseTimerRef.current);
      recRef.current?.stop();
    },
    [],
  );
  useEffect(() => {
    if (historyOpen) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, historyOpen]);

  const busy = state === "thinking" || state === "speaking";

  const submit = () => {
    if (!value.trim()) return;
    void send(value);
    setValue("");
  };

  const toggleMic = () => {
    const flushPendingSpeech = () => {
      if (phraseTimerRef.current !== undefined) {
        window.clearTimeout(phraseTimerRef.current);
        phraseTimerRef.current = undefined;
      }
      const recognized = pendingSpeechRef.current.trim();
      pendingSpeechRef.current = "";
      if (!recognized) return;
      setValue("");
      setVoiceNotice(`Te escuché: «${recognized}» · Puedes seguir hablando.`);
      void send(recognized, true);
    };

    if (voiceSessionRef.current) {
      voiceSessionRef.current = false;
      if (restartTimerRef.current !== undefined) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = undefined;
      }
      setVoiceNotice("Cerrando micrófono…");
      recRef.current?.stop();
      return;
    }

    const w = window as unknown as {
      SpeechRecognition?: new () => SRLike;
      webkitSpeechRecognition?: new () => SRLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceNotice(
        "Este navegador no ofrece reconocimiento de voz. Abre Juspross en una versión actual de Chrome o Edge para usar el micrófono.",
      );
      return;
    }

    voiceSessionRef.current = true;
    voiceEndNoticeRef.current = null;
    pendingSpeechRef.current = "";
    setListening(true);
    setVoiceNotice("Escuchando… habla con naturalidad. Pulsa el micrófono para terminar.");

    const startRecognizer = () => {
      if (!voiceSessionRef.current) return;
      const rec = new Ctor();
      rec.lang = "es-MX";
      rec.interimResults = true;
      rec.continuous = true;

      rec.onresult = (e) => {
        let interimText = "";
        let recognizedFinal = "";
        const startAt = Math.max(0, e.resultIndex ?? 0);
        for (let i = startAt; i < e.results.length; i++) {
          const result = e.results[i];
          if (!result) continue;
          const transcript = result[0].transcript.trim();
          if (!transcript) continue;
          if (result.isFinal) recognizedFinal += (recognizedFinal ? " " : "") + transcript;
          else interimText += (interimText ? " " : "") + transcript;
        }

        if (recognizedFinal) {
          pendingSpeechRef.current = [pendingSpeechRef.current, recognizedFinal]
            .filter(Boolean)
            .join(" ")
            .trim();
          if (phraseTimerRef.current !== undefined) window.clearTimeout(phraseTimerRef.current);
          // Send each complete phrase after a short pause, without turning the mic session off.
          phraseTimerRef.current = window.setTimeout(flushPendingSpeech, 1400);
          setVoiceNotice("Te escucho… enviaré tu frase cuando hagas una pausa.");
        }

        const visibleText = [pendingSpeechRef.current, interimText].filter(Boolean).join(" ").trim();
        if (visibleText) setValue(visibleText);
      };

      rec.onstart = () => {
        if (voiceSessionRef.current) {
          setListening(true);
          setVoiceNotice("Escuchando… habla con naturalidad. Pulsa el micrófono para terminar.");
        }
      };

      rec.onerror = (event) => {
        const reason = event?.error ?? "unknown";
        const fatalMessages: Record<string, string> = {
          "not-allowed": "El micrófono está bloqueado. Permite el acceso al micrófono para Juspross en los permisos del navegador.",
          "service-not-allowed": "El navegador no permite el reconocimiento de voz en esta página.",
          "audio-capture": "No se encontró un micrófono disponible. Comprueba los dispositivos de entrada de Windows.",
          "language-not-supported": "El reconocimiento de voz en español no está disponible en este navegador.",
        };
        const fatalMessage = fatalMessages[reason];
        if (fatalMessage) {
          voiceSessionRef.current = false;
          voiceEndNoticeRef.current = fatalMessage;
          if (restartTimerRef.current !== undefined) window.clearTimeout(restartTimerRef.current);
          restartTimerRef.current = undefined;
          flushPendingSpeech();
          setListening(false);
          setVoiceNotice(fatalMessage);
          return;
        }
        if (reason === "no-speech") {
          // Silence is normal during a hands-free session: the onend handler will restart it.
          return;
        }
        setVoiceNotice(
          reason === "network"
            ? "Se interrumpió el reconocimiento de voz por la conexión; intentaré reactivarlo."
            : `El reconocimiento se interrumpió (${reason}); intentando reactivarlo.`,
        );
      };

      rec.onend = () => {
        if (recRef.current === rec) recRef.current = null;
        if (!voiceSessionRef.current) {
          setListening(false);
          flushPendingSpeech();
          const endNotice = voiceEndNoticeRef.current;
          voiceEndNoticeRef.current = null;
          setVoiceNotice(endNotice ?? "Micrófono apagado.");
          return;
        }
        // SpeechRecognition may end by itself after a pause. Keep the user's listening
        // session alive and start a fresh recognizer unless they tapped the mic to stop.
        setVoiceNotice("Reactivando el micrófono…");
        if (restartTimerRef.current !== undefined) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = undefined;
          startRecognizer();
        }, 500);
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch (error) {
        if (error instanceof Error && error.name === "InvalidStateError") {
          restartTimerRef.current = window.setTimeout(startRecognizer, 650);
          return;
        }
        voiceSessionRef.current = false;
        setListening(false);
        recRef.current = null;
        setVoiceNotice("No se pudo activar el micrófono. Comprueba los permisos del navegador y vuelve a intentarlo.");
      }
    };

    startRecognizer();
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

  if (secretV3) {
    return (
      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/20">
        <div className="text-center animate-rise">
          <p className="font-mono text-[10px] tracking-[0.55em] text-[#8ab5ff]/70">ACCESO OCULTO · NÚCLEO ATRAVESADO</p>
          <h1 className="mt-5 font-light text-[clamp(42px,8vw,92px)] tracking-[0.38em] text-white/90">JUSPROSS <span className="text-[#6ea8ff]">3.0</span></h1>
          <p className="mt-5 font-mono text-sm tracking-[0.7em] text-[#9cc0ff]">HOLA</p>
          <p className="mt-4 font-mono text-[9px] tracking-[0.25em] text-white/35">ALEJA LA RUEDA PARA REGRESAR</p>
        </div>
      </div>
    );
  }

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
      <div className="pointer-events-auto absolute top-4 right-5 z-40">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Ajustes de la IA"
          title="Ajustes de la IA"
          className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/60 backdrop-blur-md transition-colors hover:text-white"
        >
          {open ? <X className="size-4" /> : <Settings2 className="size-4" />}
        </button>
        {open && <AiSettings onClose={() => setOpen(false)} />}
      </div>

      {/* botón de historial, en el lateral derecho */}
      <div className="pointer-events-auto absolute top-16 right-5 z-40">
        <button
          onClick={() => setHistoryOpen((shown) => !shown)}
          aria-label={historyOpen ? "Cerrar historial del chat" : "Abrir historial del chat"}
          aria-expanded={historyOpen}
          title={historyOpen ? "Cerrar historial" : "Historial del chat"}
          className={cn(
            "relative flex size-9 items-center justify-center rounded-full border bg-black/60 text-white/70 backdrop-blur-md transition-colors hover:text-white",
            historyOpen ? "border-[#6ea8ff]/60 text-[#9cc0ff]" : "border-white/10",
          )}
        >
          {historyOpen ? <X className="size-4" /> : <History className="size-4" />}
          {messages.length > 0 && !historyOpen && (
            <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full border border-black bg-[#6ea8ff] px-1 font-mono text-[9px] leading-4 text-black">
              {messages.length > 99 ? "99+" : messages.length}
            </span>
          )}
        </button>
      </div>

      {/* historial desplegable a la derecha */}
      {historyOpen && (
        <aside
          aria-label="Historial del chat"
          className="pointer-events-auto absolute right-5 top-28 bottom-20 z-40 flex w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-white/10 bg-black/85 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="font-mono text-[10px] tracking-[0.25em] text-[#6ea8ff]">
                HISTORIAL DEL CHAT
              </p>
              <p className="mt-1 text-[11px] text-white/45">
                {messages.length} {messages.length === 1 ? "mensaje" : "mensajes"}
              </p>
            </div>
            <button
              onClick={() => setHistoryOpen(false)}
              aria-label="Cerrar historial"
              className="flex size-8 items-center justify-center rounded-md border border-white/10 text-white/60 transition-colors hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
          <div
            ref={logRef}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 [scrollbar-color:rgba(255,255,255,0.25)_transparent]"
          >
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-5 text-center text-sm text-white/40">
                Tus mensajes aparecerán aquí cuando empieces a conversar con Juspross.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex w-full", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[92%] break-words rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                      m.role === "user"
                        ? "border border-white/10 bg-white/5 text-white/75"
                        : m.error
                          ? "border border-red-500/40 bg-red-950/40 text-red-200"
                          : "border border-[#3d7bff]/25 bg-[#090d16]/90 text-white/90",
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
              ))
            )}
          </div>
        </aside>
      )}

      {/* cuadro de entrada fijo abajo; los mensajes viven en el panel lateral */}
      <div className="absolute bottom-5 left-1/2 w-[min(720px,calc(100vw-260px))] min-w-[300px] -translate-x-1/2">
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
          <button
            onClick={toggleMic}
            aria-label={listening ? "Detener micrófono" : "Hablar con Juspross"}
            title={listening ? "Detener escucha" : "Pulsa para hablar con Juspross"}
            aria-pressed={listening}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
              listening ? "animate-pulse bg-[#ff3b4e]/20 text-[#ff6b7a]" : "text-white/55 hover:text-white",
            )}
          >
            <Mic className="size-4.5" strokeWidth={1.6} />
          </button>
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
        {voiceNotice && (
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "pointer-events-none mt-2 text-center text-[11px] leading-snug",
              listening ? "text-[#ff8c98]" : "text-white/65",
            )}
          >
            {voiceNotice}
          </p>
        )}
        <p className="pointer-events-none mt-2 text-center font-mono text-[9px] tracking-[0.25em] text-white/30">
          PULSA EL MICRÓFONO, HABLA Y JUSPROSS ENVIARÁ TU MENSAJE
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
    // A click is intentional: Chrome may require a user gesture for first local-network access.
    const s = useV2.getState();
    s.setAutoConnect(false);
    s.setAi({ endpoint: ep, model: md });
    s.setLink("checking", "Autorizando y comprobando conexión con Ollama…");
    try {
      const current = useV2.getState();
      const m = await testAi(current.aiEndpoint, current.aiModel);
      useV2.getState().setAi({ endpoint: current.aiEndpoint, model: m });
      useV2.getState().setAutoConnect(true);
      useV2.getState().setLink(
        "online",
        `Conectado · ${m}. La reconexión automática quedó activada para las próximas aperturas.`,
      );
    } catch (e) {
      // Keep automatic retries enabled even when this manual probe fails.
      // The connection effect will keep retrying while Ollama / permissions are fixed.
      useV2.getState().setAutoConnect(true);
      useV2.getState().setLink(
        "offline",
        e instanceof Error ? e.message : "No se pudo conectar. Revisa Ollama, el permiso de loopback y OLLAMA_ORIGINS.",
      );
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
          MODELO DE IA (predeterminado: qwen3:8b)
        </span>
        <input
          className={field}
          value={md}
          onChange={(e) => setMd(e.target.value)}
          placeholder="qwen3:8b"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void test()}
          className="flex-1 rounded-md border border-[#3d7bff]/50 bg-[#3d7bff]/15 py-1.5 font-mono text-[10px] tracking-[0.2em] text-[#9cc0ff] hover:bg-[#3d7bff]/25"
        >
          CONECTAR Y RECORDAR
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
