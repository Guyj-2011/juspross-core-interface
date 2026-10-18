import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, History, Mic, Settings2, Square, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { AiUnreachable, testAi } from "@/lib/juspross/ai";
import { useV2Chat } from "@/lib/juspross/useV2Chat";
import { useV2 } from "@/lib/juspross/v2Store";
import { cn } from "@/lib/utils";

interface BrowserSpeechResult {
  0: { transcript: string };
  isFinal: boolean;
}

interface BrowserSpeechEvent {
  resultIndex: number;
  results: { length: number; [index: number]: BrowserSpeechResult };
}

interface BrowserSpeechLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
}

type BrowserSpeechConstructor = new () => BrowserSpeechLike;

function extractTranscript(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";

  const data = payload as Record<string, unknown>;
  const directKeys = ["text", "transcription", "transcripcion", "output", "resultado", "mensaje"];
  for (const key of directKeys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  for (const key of ["segmentos", "segments"]) {
    const segments = data[key];
    if (!Array.isArray(segments)) continue;
    const text = segments
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (!entry || typeof entry !== "object") return "";
        const segment = entry as Record<string, unknown>;
        for (const field of ["text", "texto", "transcription", "transcripcion"]) {
          const value = segment[field];
          if (typeof value === "string" && value.trim()) return value.trim();
        }
        const words = segment["palabras"] ?? segment["words"];
        if (Array.isArray(words)) {
          return words
            .map((word) => {
              if (typeof word === "string") return word;
              if (!word || typeof word !== "object") return "";
              const item = word as Record<string, unknown>;
              return String(item["texto"] ?? item["palabra"] ?? item["word"] ?? item["text"] ?? "");
            })
            .filter(Boolean)
            .join(" ");
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) return text;
  }

  return "";
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
  const [copyStatus, setCopyStatus] = useState("");
  const [secretV3, setSecretV3] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const browserSpeechRef = useRef<BrowserSpeechLike | null>(null);
  const voiceEngineRef = useRef<"browser" | "local" | "switching" | null>(null);
  const voiceSessionRef = useRef(false);
  const browserFallbackTimerRef = useRef<number | undefined>(undefined);
  const browserRestartTimerRef = useRef<number | undefined>(undefined);
  const browserHadResultRef = useRef(false);
  const browserStartedAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const speechDetectedRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const transcribingRef = useRef(false);
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
      if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
      if (browserFallbackTimerRef.current !== undefined) window.clearTimeout(browserFallbackTimerRef.current);
      if (browserRestartTimerRef.current !== undefined) window.clearTimeout(browserRestartTimerRef.current);
      browserSpeechRef.current?.stop();
      browserSpeechRef.current = null;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        try { recorder.stop(); } catch { /* cierre de componente */ }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const context = audioContextRef.current;
      if (context && context.state !== "closed") void context.close();
      streamRef.current = null;
      audioContextRef.current = null;
      analyserRef.current = null;
      voiceEngineRef.current = null;
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

  const copyVoiceDiagnostics = async () => {
    let micPermission = "no disponible";
    try {
      micPermission = (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
    } catch {
      // Algunos WebView no exponen Permissions.query para micrófonos.
    }

    const w = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    const diagnostic = [
      "JUSPROSS — DIAGNÓSTICO DE VOZ",
      `Mensaje: ${voiceNotice || "No hay mensaje de estado"}`,
      `Página: ${window.location.href}`,
      `Modo Lively solicitado: ${new URLSearchParams(window.location.search).get("lively") === "1" || new URLSearchParams(window.location.search).get("voice") === "local"}`,
      `Permiso de micrófono reportado por el navegador: ${micPermission}`,
      `getUserMedia: ${Boolean(navigator.mediaDevices?.getUserMedia)}`,
      `MediaRecorder: ${typeof MediaRecorder !== "undefined"}`,
      `SpeechRecognition: ${Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)}`,
      "Servidor Whisper esperado: http://127.0.0.1:8001/transcribe",
      `Navegador integrado: ${navigator.userAgent}`,
    ].join("\n");

    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnostic);
        copied = true;
      }
    } catch {
      // Intentar la copia tradicional que suele estar disponible en WebView.
    }

    if (!copied) {
      const field = document.createElement("textarea");
      field.value = diagnostic;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      field.style.top = "0";
      document.body.appendChild(field);
      field.focus();
      field.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      field.remove();
    }

    setCopyStatus(copied ? "copied" : "No se pudo copiar automáticamente. Mantén pulsado o selecciona el mensaje para copiarlo.");
  };

  const startLocalMicrophone = async () => {
    const releaseMicrophone = () => {
      if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      analyserRef.current = null;
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") void context.close();
      recorderRef.current = null;
      if (voiceEngineRef.current === "local") voiceEngineRef.current = null;
    };

    const transcribeAudio = async (blob: Blob) => {
      const endpoint = "http://127.0.0.1:8001/transcribe";
      const form = new FormData();
      const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("wav") ? "wav" : "webm";
      form.append("file", blob, `juspross-voz.${extension}`);

      let response: Response;
      try {
        // Whisper is an HTTP service on this PC (127.0.0.1). Tell Chromium
        // explicitly that this request targets the loopback address space, just
        // like the Ollama client in ai.ts. Modern Chromium may otherwise reject
        // secure-page → loopback requests before they reach FastAPI.
        response = await fetch(endpoint, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60_000),
          targetAddressSpace: "loopback",
        } as RequestInit & { targetAddressSpace: "loopback" });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const origin = window.location.origin;
        throw new Error(
          `No pude completar la conexión con el servidor local de transcripción (${endpoint}). Origen de Juspross: ${origin}. Detalle del navegador: ${detail}. Comprueba que la API esté ejecutándose en el puerto 8001, que FastAPI permita CORS para este origen y que Lively/Chromium permita "Red de bucle invertido" (loopback network).`,
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `El servidor de transcripción respondió HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}.`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("El servidor de transcripción respondió, pero no devolvió JSON válido.");
      }

      const transcript = extractTranscript(payload);
      if (!transcript) {
        throw new Error("El servidor recibió el audio, pero no devolvió texto reconocido. Habla más cerca del micrófono y vuelve a probar.");
      }

      setVoiceNotice(`Te escuché: «${transcript}»`);
      setValue("");
      void send(transcript, true);
    };

    if (voiceSessionRef.current) {
      voiceSessionRef.current = false;
      setVoiceNotice("Cerrando micrófono…");
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          releaseMicrophone();
          setListening(false);
          setVoiceNotice("Micrófono apagado.");
        }
      } else {
        releaseMicrophone();
        setListening(false);
        setVoiceNotice("Micrófono apagado.");
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceNotice("Este navegador no permite capturar audio con MediaRecorder. Prueba Juspross en Chrome o Edge actualizado.");
      return;
    }

    voiceSessionRef.current = true;
    voiceEngineRef.current = "local";
    setListening(true);
    setVoiceNotice("Solicitando acceso al micrófono local…");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!voiceSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
        return;
      }

      streamRef.current = stream;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyserRef.current = analyser;

      const options: MediaRecorderOptions | undefined =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? { mimeType: "audio/webm;codecs=opus" }
          : MediaRecorder.isTypeSupported("audio/webm")
            ? { mimeType: "audio/webm" }
            : undefined;

      const startRecorder = () => {
        const activeStream = streamRef.current;
        if (!voiceSessionRef.current || transcribingRef.current || !activeStream) return;
        chunksRef.current = [];
        speechDetectedRef.current = false;
        lastVoiceAtRef.current = 0;

        let recorder: MediaRecorder;
        try {
          recorder = options ? new MediaRecorder(activeStream, options) : new MediaRecorder(activeStream);
        } catch (error) {
          voiceSessionRef.current = false;
          setListening(false);
          setVoiceNotice(
            `No pude iniciar la grabación de audio. ${error instanceof Error ? error.message : ""}`,
          );
          releaseMicrophone();
          return;
        }

        recorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (!event.data || event.data.size === 0) return;
          if (speechDetectedRef.current) chunksRef.current.push(event.data);
          else chunksRef.current = [];
        };
        recorder.onerror = () => {
          setVoiceNotice("El navegador interrumpió la grabación del micrófono. Vuelve a pulsar el botón para intentarlo.");
        };
        recorder.onstart = () => {
          setListening(true);
          setVoiceNotice("Micrófono activo. Habla con naturalidad; enviaré tu frase después de una pausa.");
        };
        recorder.onstop = () => {
          if (recorderRef.current === recorder) recorderRef.current = null;
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const hadSpeech = speechDetectedRef.current;
          chunksRef.current = [];
          speechDetectedRef.current = false;

          void (async () => {
            if (hadSpeech && blob.size > 1200) {
              transcribingRef.current = true;
              setVoiceNotice("Procesando tu voz con el transcriptor local…");
              try {
                await transcribeAudio(blob);
              } catch (error) {
                // Stop the capture loop on failure; otherwise the next recorder.onstart
                // overwrites this diagnostic almost immediately with "Micrófono activo".
                voiceSessionRef.current = false;
                setListening(false);
                setVoiceNotice(
                  `${error instanceof Error ? error.message : "No se pudo transcribir el audio."}\nLa escucha se detuvo para conservar este diagnóstico.`,
                );
              } finally {
                transcribingRef.current = false;
              }
            } else if (voiceSessionRef.current) {
              setVoiceNotice("No detecté una frase clara todavía. Puedes seguir hablando.");
            }

            if (voiceSessionRef.current) {
              startRecorder();
            } else {
              releaseMicrophone();
              setListening(false);
              if (!hadSpeech || blob.size <= 1200) setVoiceNotice("Micrófono apagado.");
            }
          })();
        };

        try {
          recorder.start(250);
        } catch (error) {
          if (error instanceof Error && error.name === "InvalidStateError") {
            window.setTimeout(startRecorder, 300);
            return;
          }
          voiceSessionRef.current = false;
          setListening(false);
          setVoiceNotice("No se pudo iniciar la grabación. Comprueba que otra aplicación no esté bloqueando el micrófono.");
          releaseMicrophone();
        }
      };

      startRecorder();

      const samples = new Uint8Array(analyser.fftSize);
      const monitorAudio = () => {
        if (!voiceSessionRef.current) {
          animationFrameRef.current = undefined;
          return;
        }

        const activeAnalyser = analyserRef.current;
        if (activeAnalyser) {
          activeAnalyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            const normalized = (samples[i]! - 128) / 128;
            sum += normalized * normalized;
          }
          const rms = Math.sqrt(sum / samples.length);
          const now = performance.now();
          if (rms > 0.014) {
            speechDetectedRef.current = true;
            lastVoiceAtRef.current = now;
          } else if (
            speechDetectedRef.current &&
            lastVoiceAtRef.current > 0 &&
            now - lastVoiceAtRef.current > 1550 &&
            recorderRef.current?.state === "recording" &&
            !transcribingRef.current
          ) {
            try {
              recorderRef.current.stop();
            } catch {
              /* el grabador ya se está deteniendo */
            }
          }
        }
        animationFrameRef.current = requestAnimationFrame(monitorAudio);
      };

      animationFrameRef.current = requestAnimationFrame(monitorAudio);
    } catch (error) {
      voiceSessionRef.current = false;
      setListening(false);
      const name = error instanceof Error ? error.name : "";
      const messages: Record<string, string> = {
        NotAllowedError: "El acceso al micrófono está bloqueado. Permite el micrófono para Juspross en los permisos del navegador o de Lively Wallpaper.",
        NotFoundError: "No se encontró ningún micrófono. Comprueba el dispositivo de entrada seleccionado en Windows.",
        NotReadableError: "El micrófono está ocupado por otra aplicación o Windows no permite abrirlo.",
        SecurityError: "El navegador bloqueó el micrófono por permisos de seguridad.",
      };
      setVoiceNotice(messages[name] ?? `No se pudo activar el micrófono: ${error instanceof Error ? error.message : String(error)}`);
      releaseMicrophone();
    }
  };

  const toggleMic = async () => {
    // If the local Whisper capture is active, reuse its existing stop/finalize path.
    if (voiceSessionRef.current) {
      if (voiceEngineRef.current === "local") {
        await startLocalMicrophone();
        return;
      }

      voiceSessionRef.current = false;
      if (browserFallbackTimerRef.current !== undefined) window.clearTimeout(browserFallbackTimerRef.current);
      if (browserRestartTimerRef.current !== undefined) window.clearTimeout(browserRestartTimerRef.current);
      browserFallbackTimerRef.current = undefined;
      browserRestartTimerRef.current = undefined;
      voiceEngineRef.current = null;
      browserSpeechRef.current?.stop();
      browserSpeechRef.current = null;
      setListening(false);
      setVoiceNotice("Micrófono apagado.");
      return;
    }

    if (transcribingRef.current) {
      setVoiceNotice("Estoy procesando la frase anterior. Espera a que termine antes de hablar de nuevo.");
      return;
    }

    // Lively runs this page in an embedded WebView. In that mode, skip remote
    // browser speech recognition and request the microphone immediately from the
    // button click, preserving the browser's user-activation context. Enable with
    // ?lively=1 (or ?voice=local) on the wallpaper URL.
    const voiceParams = new URLSearchParams(window.location.search);
    const directLocalVoice = voiceParams.get("lively") === "1" || voiceParams.get("voice") === "local";
    if (directLocalVoice) {
      setVoiceNotice("Modo Lively: abriendo el micrófono local directamente…");
      await startLocalMicrophone();
      return;
    }

    const w = window as unknown as {
      SpeechRecognition?: BrowserSpeechConstructor;
      webkitSpeechRecognition?: BrowserSpeechConstructor;
    };
    const SpeechCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition;

    // The browser engine is the proven path in Lovable preview. If it is absent,
    // fails, or returns no transcript, fall back to local audio capture + Whisper.
    if (!SpeechCtor) {
      void startLocalMicrophone();
      return;
    }

    const fallbackToLocal = (reason: string) => {
      if (!voiceSessionRef.current || voiceEngineRef.current !== "browser") return;
      if (browserHadResultRef.current) return;
      if (browserFallbackTimerRef.current !== undefined) window.clearTimeout(browserFallbackTimerRef.current);
      if (browserRestartTimerRef.current !== undefined) window.clearTimeout(browserRestartTimerRef.current);
      browserFallbackTimerRef.current = undefined;
      browserRestartTimerRef.current = undefined;
      voiceEngineRef.current = "switching";
      setVoiceNotice(`${reason} Cambiando al transcriptor local…`);
      const current = browserSpeechRef.current;
      browserSpeechRef.current = null;
      try { current?.stop(); } catch { /* el reconocimiento ya terminó */ }

      window.setTimeout(() => {
        if (!voiceSessionRef.current || voiceEngineRef.current !== "switching") return;
        voiceSessionRef.current = false;
        voiceEngineRef.current = null;
        void startLocalMicrophone();
      }, 400);
    };

    const armBrowserFallback = () => {
      if (browserFallbackTimerRef.current !== undefined) window.clearTimeout(browserFallbackTimerRef.current);
      browserFallbackTimerRef.current = window.setTimeout(() => {
        if (voiceEngineRef.current === "browser" && voiceSessionRef.current && !browserHadResultRef.current) {
          fallbackToLocal("El navegador no ha completado una transcripción.");
        }
      }, 8000);
    };

    const startBrowserRecognition = () => {
      if (!voiceSessionRef.current || voiceEngineRef.current !== "browser") return;
      let recognition: BrowserSpeechLike;
      try {
        recognition = new SpeechCtor();
      } catch {
        fallbackToLocal("No se pudo iniciar el reconocimiento del navegador.");
        return;
      }
      recognition.lang = "es-MX";
      recognition.continuous = true;
      recognition.interimResults = true;
      browserSpeechRef.current = recognition;

      recognition.onstart = () => {
        if (voiceSessionRef.current && voiceEngineRef.current === "browser") {
          setListening(true);
          setVoiceNotice("Escuchando con el navegador… habla normalmente. Pulsa el micrófono para terminar.");
        }
      };

      recognition.onresult = (event) => {
        if (voiceEngineRef.current !== "browser" || !voiceSessionRef.current) return;

        const finals: string[] = [];
        const interims: string[] = [];
        const startIndex = Math.max(0, event.resultIndex ?? 0);
        for (let i = startIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const transcript = result[0].transcript.trim();
          if (!transcript) continue;
          (result.isFinal ? finals : interims).push(transcript);
        }

        const finalText = finals.join(" ").trim();
        const interimText = interims.join(" ").trim();
        if (finalText) {
          browserHadResultRef.current = true;
          if (browserFallbackTimerRef.current !== undefined) window.clearTimeout(browserFallbackTimerRef.current);
          browserFallbackTimerRef.current = undefined;
          setValue("");
          setVoiceNotice(`Te escuché: «${finalText}»`);
          void send(finalText, true);
        } else if (interimText) {
          browserStartedAtRef.current = Date.now();
          setValue(interimText);
          setVoiceNotice(`Reconociendo: «${interimText}»`);
          armBrowserFallback();
        }
      };

      recognition.onerror = (event) => {
        const reason = event?.error ?? "unknown";
        if (["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"].includes(reason)) {
          fallbackToLocal(`El reconocimiento del navegador falló (${reason}).`);
          return;
        }
        setVoiceNotice(`El navegador sigue intentando reconocer la voz (${reason}).`);
      };

      recognition.onend = () => {
        if (browserSpeechRef.current === recognition) browserSpeechRef.current = null;
        if (!voiceSessionRef.current || voiceEngineRef.current !== "browser") return;

        if (!browserHadResultRef.current && Date.now() - browserStartedAtRef.current >= 8000) {
          fallbackToLocal("El navegador no devolvió ninguna transcripción.");
          return;
        }

        if (browserRestartTimerRef.current !== undefined) window.clearTimeout(browserRestartTimerRef.current);
        browserRestartTimerRef.current = window.setTimeout(() => {
          browserRestartTimerRef.current = undefined;
          startBrowserRecognition();
        }, 500);
      };

      try {
        recognition.start();
      } catch (error) {
        fallbackToLocal(
          error instanceof Error ? `No se pudo iniciar el reconocimiento (${error.name}).` : "No se pudo iniciar el reconocimiento del navegador.",
        );
      }
    };

    voiceSessionRef.current = true;
    voiceEngineRef.current = "browser";
    browserHadResultRef.current = false;
    browserStartedAtRef.current = Date.now();
    setListening(true);
    setVoiceNotice("Activando el reconocimiento de voz…");

    armBrowserFallback();
    startBrowserRecognition();
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
          <div className="pointer-events-auto mt-2 flex items-start justify-center gap-2 text-[11px] leading-snug">
            <p
              role="status"
              aria-live="polite"
              className={cn(
                "max-w-[620px] cursor-text select-text whitespace-pre-wrap break-words text-center",
                listening ? "text-[#ff8c98]" : "text-white/75",
              )}
            >
              {voiceNotice}
            </p>
            <button
              type="button"
              onClick={() => void copyVoiceDiagnostics()}
              aria-label="Copiar diagnóstico de voz"
              title="Copiar diagnóstico de voz"
              className="flex size-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/70 text-white/70 hover:border-[#6ea8ff]/60 hover:text-[#9cc0ff]"
            >
              {copyStatus === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        )}
        {copyStatus && (
          <p className="pointer-events-none mt-1 select-text text-center text-[10px] text-white/55">
            {copyStatus === "copied" ? "Diagnóstico copiado al portapapeles." : copyStatus}
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
