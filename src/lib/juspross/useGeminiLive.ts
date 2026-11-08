import { useCallback, useEffect, useRef, useState } from "react";
import {
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_WS,
  LIVE_OUTPUT_RATE,
  base64ToPcmFloat,
  bytesToBase64,
  floatToPcm16,
} from "./geminiLiveConfig";
import { useV2 } from "./v2Store";
import { describeLocalResult, openSpotifyDesktop } from "./localAgent";

export type LiveStatus = "off" | "connecting" | "live" | "error";

type ServerMsg = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  goAway?: unknown;
  toolCall?: { functionCalls?: { id: string; name: string; args?: Record<string, unknown> }[] };
  error?: { message?: string };
};

/** Sesión de voz bidireccional con Gemini Live usando un token efímero del servidor. */
export function useGeminiLive() {
  const [status, setStatus] = useState<LiveStatus>("off");
  const [notice, setNotice] = useState("");
  const cleanupRef = useRef<(() => void) | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef("");

  const stop = useCallback((message = "Gemini Live desconectado.") => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setStatus((s) => (s === "error" ? s : "off"));
    if (message) setNotice(message);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("juspross-live-microphone");
    const tabId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tabIdRef.current = tabId;
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ type?: string; tabId?: string }>) => {
      if (event.data?.type !== "claim" || event.data.tabId === tabId) return;
      if (!cleanupRef.current) return;
      cleanupRef.current();
      cleanupRef.current = null;
      setStatus("off");
      setNotice("El micrófono se trasladó a la otra ventana de Juspross.");
    };
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (cleanupRef.current) return;
    setStatus("connecting");
    setNotice("Conectando con Gemini Live…");
    let ws: WebSocket | null = null;
    let stream: MediaStream | null = null;
    let inCtx: AudioContext | null = null;
    let outCtx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;
    let raf = 0;
    let closed = false;
    const sources = new Set<AudioBufferSourceNode>();
    let userId: string | null = null;
    let botId: string | null = null;
    let userText = "";
    let botText = "";
    let resumeAudio: (() => void) | null = null;

    const flushPlayback = () => {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* ended */
        }
      }
      sources.clear();
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      flushPlayback();
      processor?.disconnect();
      if (resumeAudio) {
        document.removeEventListener("visibilitychange", resumeAudio);
        window.removeEventListener("focus", resumeAudio);
        resumeAudio = null;
      }
      stream?.getTracks().forEach((t) => t.stop());
      if (ws && ws.readyState <= 1) ws.close(1000);
      void inCtx?.close().catch(() => {});
      void outCtx?.close().catch(() => {});
      const st = useV2.getState();
      st.setAmplitude(0);
      if (st.state !== "error") st.setState("idle");
    };
    cleanupRef.current = cleanup;
    const fail = (msg: string) => {
      cleanup();
      cleanupRef.current = null;
      setStatus("error");
      setNotice(msg);
    };

    try {
      // Crear y desbloquear los contextos de audio inmediatamente desde el clic
      // del usuario, antes de que el permiso del micrófono o la red consuman la activación.
      inCtx = new AudioContext();
      outCtx = new AudioContext({ sampleRate: LIVE_OUTPUT_RATE });
      resumeAudio = () => {
        if (closed) return;
        if (inCtx?.state === "suspended") void inCtx.resume().catch(() => {});
        if (outCtx?.state === "suspended") void outCtx.resume().catch(() => {});
      };
      document.addEventListener("visibilitychange", resumeAudio);
      window.addEventListener("focus", resumeAudio);
      const initialAudioResume = Promise.all([inCtx.resume(), outCtx.resume()]);

      // Solo una ventana de Juspross captura el micrófono a la vez.
      // La ventana solicitante toma el turno y las demás liberan su sesión activa.
      if (channelRef.current) {
        channelRef.current.postMessage({ type: "claim", tabId: tabIdRef.current });
        await new Promise((resolve) => window.setTimeout(resolve, 220));
      }

      // Pedir el micrófono dentro del mismo gesto de activación.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      if (closed) return;
      await initialAudioResume;

      const res = await fetch("/api/gemini-live-token", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
      if (!res.ok || !j.token)
        return fail(j.message ?? `No se obtuvo el token de Gemini Live (${res.status}).`);
      if (closed) return;

      const analyser = outCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.connect(outCtx.destination);
      const wave = new Uint8Array(analyser.fftSize);
      const meter = () => {
        analyser.getByteTimeDomainData(wave);
        let p = 0;
        for (const v of wave) p += ((v - 128) / 128) ** 2;
        useV2.getState().setAmplitude(Math.min(1, Math.sqrt(p / wave.length) * 3));
        raf = requestAnimationFrame(meter);
      };
      meter();
      let playhead = 0;

      const socket = new WebSocket(`${GEMINI_LIVE_WS}?access_token=${encodeURIComponent(j.token)}`);
      ws = socket;
      socket.onopen = () => socket.send(JSON.stringify({ setup: { model: GEMINI_LIVE_MODEL } }));
      socket.onerror = () => {
        if (!closed) fail("Error de conexión con Gemini Live.");
      };
      socket.onclose = (e) => {
        if (closed) return;
        fail(
          e.code === 1000
            ? "Gemini Live cerró la sesión."
            : `Gemini Live cerró la conexión (${e.code}) ${e.reason}`.trim(),
        );
      };

      const startMic = () => {
        const src = inCtx!.createMediaStreamSource(stream!);
        processor = inCtx!.createScriptProcessor(4096, 1, 1);
        const rate = inCtx!.sampleRate;
        processor.onaudioprocess = (ev) => {
          if (socket.readyState !== 1) return;
          const pcm = floatToPcm16(ev.inputBuffer.getChannelData(0), rate);
          socket.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  data: bytesToBase64(new Uint8Array(pcm.buffer)),
                  mimeType: "audio/pcm;rate=16000",
                },
              },
            }),
          );
        };
        src.connect(processor);
        // Salida silenciada: ScriptProcessor necesita estar conectado para procesar.
        const mute = inCtx!.createGain();
        mute.gain.value = 0;
        processor.connect(mute).connect(inCtx!.destination);
      };

      const handleToolCalls = async (calls: NonNullable<ServerMsg["toolCall"]>["functionCalls"]) => {
        if (!calls?.length) return;
        const responses: { id: string; name: string; response: Record<string, unknown> }[] = [];
        for (const call of calls) {
          if (call.name === "open_spotify_desktop") {
            // Se ejecuta en el navegador contra el agente local; al modelo solo llega el resultado.
            const result = await openSpotifyDesktop();
            const message = describeLocalResult(result);
            useV2.getState().addMessage({ role: "assistant", text: message, error: !result.ok });
            responses.push({ id: call.id, name: call.name, response: { ok: result.ok, reason: result.reason, message } });
            continue;
          }
          if (call.name !== "delegate_to_nemotron") {
            responses.push({ id: call.id, name: call.name, response: { error: "Herramienta no disponible." } });
            continue;
          }
          const args = call.args ?? {};
          const task = typeof args["task"] === "string" ? args["task"].trim() : "";
          const context = typeof args["context"] === "string" ? args["context"].trim() : "";
          if (!task) {
            responses.push({ id: call.id, name: call.name, response: { error: "Nemotron necesita una descripción de la tarea." } });
            continue;
          }
          const progressId = useV2.getState().addMessage({
            role: "assistant",
            text: "Delegando tarea a Nemotron…"
          });
          try {
            const response = await fetch("/api/agent-delegate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ task, context }),
            });
            const payload = await response.json().catch(() => ({})) as { result?: string; message?: string };
            if (!response.ok || !payload.result) throw new Error(payload.message ?? `Nemotron respondió ${response.status}.`);
            useV2.getState().patchMessage(progressId, {
              text: `Nemotron completó el análisis de la tarea:\n\n${payload.result}`
            });
            responses.push({ id: call.id, name: call.name, response: { result: payload.result, status: "analysis_complete", execution: "not_available" } });
          } catch (error) {
            const message = error instanceof Error ? error.message : "No se pudo contactar con Nemotron.";
            useV2.getState().patchMessage(progressId, { text: `No se pudo completar la delegación: ${message}`, error: true });
            responses.push({ id: call.id, name: call.name, response: { error: message } });
          }
        }
        if (!closed && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
        }
      };

      socket.onmessage = async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
        let msg: ServerMsg;
        try {
          msg = JSON.parse(raw) as ServerMsg;
        } catch {
          return;
        }
        const st = useV2.getState();
        if (msg.error) return fail(msg.error.message ?? "Gemini Live devolvió un error.");
        if (msg.toolCall?.functionCalls?.length) {
          void handleToolCalls(msg.toolCall.functionCalls);
          return;
        }
        if (msg.setupComplete) {
          startMic();
          setStatus("live");
          setNotice(
            "Gemini Live activo. Habla con naturalidad; puedes interrumpir en cualquier momento.",
          );
          st.setState("idle");
          return;
        }
        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.inputTranscription?.text) {
          userText += sc.inputTranscription.text;
          if (!userId) userId = st.addMessage({ role: "user", text: userText.trim() });
          else st.patchMessage(userId, { text: userText.trim() });
        }
        if (sc.outputTranscription?.text) {
          botText += sc.outputTranscription.text;
          if (!botId) botId = st.addMessage({ role: "assistant", text: botText.trim() });
          else st.patchMessage(botId, { text: botText.trim() });
        }
        for (const part of sc.modelTurn?.parts ?? []) {
          const data = part.inlineData?.data;
          if (!data || !outCtx) continue;
          const samples = base64ToPcmFloat(data);
          if (!samples.length) continue;
          const buf = outCtx.createBuffer(1, samples.length, LIVE_OUTPUT_RATE);
          buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
          const s = outCtx.createBufferSource();
          s.buffer = buf;
          s.connect(analyser);
          s.onended = () => sources.delete(s);
          sources.add(s);
          playhead = Math.max(playhead, outCtx.currentTime + 0.05);
          s.start(playhead);
          playhead += buf.duration;
          if (st.state !== "speaking") st.setState("speaking");
        }
        if (sc.interrupted) {
          flushPlayback();
          playhead = 0;
          st.setState("idle");
        }
        if (sc.turnComplete || sc.interrupted) {
          userId = botId = null;
          userText = botText = "";
          if (!sc.interrupted && outCtx) {
            const wait = Math.max(0, (playhead - outCtx.currentTime) * 1000);
            setTimeout(() => {
              if (!closed && useV2.getState().state === "speaking")
                useV2.getState().setState("idle");
            }, wait);
          }
        }
      };
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      fail(
        name === "NotAllowedError"
          ? "El acceso al micrófono está bloqueado. Permítelo para usar Gemini Live."
          : name === "NotFoundError"
            ? "No se encontró ningún micrófono."
            : `No se pudo iniciar Gemini Live: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, []);

  return { status, notice, start, stop };
}
