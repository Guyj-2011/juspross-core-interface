import { useCallback, useEffect, useRef } from "react";
import { AiError, AiUnreachable, chat, simulate, type AiMsg } from "./ai";
import { speak } from "./useSpeech";
import { useV2 } from "./v2Store";

function isSpotifyRequest(text: string): boolean {
  const value = text.toLocaleLowerCase("es");
  const action = /\\b(reproduce|reproducir|pon|ponme|pausa|pausar|reanuda|reanudar|siguiente|anterior|avanza|retrocede|salta|qu[eé] suena|qu[eé] est[aá] sonando)\\b/.test(value);
  const target = /\\b(spotify|m[uú]sica|canci[oó]n|playlist|artista|reproducci[oó]n|tema)\\b/.test(value);
  return action && target;
}

/** Conversación del lado 2.0: usuario → Qwen (Ollama) → respuesta en streaming. */
export function useV2Chat() {
  const abortRef = useRef<AbortController | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    stopSpeakRef.current?.();
    useV2.getState().setAmplitude(0);
    useV2.getState().setState("idle");
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    const s = useV2.getState();
    s.setAmplitude(0);
    if (s.state !== "error") s.setState("idle");
  }, []);

  const send = useCallback(
    async (raw: string, viaVoice = false) => {
      const text = raw.trim();
      if (!text) return;
      stop();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const s = useV2.getState();
      const history: AiMsg[] = s.messages
        .filter((m) => !m.error && m.text)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.text }));
      history.push({ role: "user", content: text });

      s.addMessage({ role: "user", text });
      const id = s.addMessage({ role: "assistant", text: "" });
      s.setState("thinking");

      let simulated = false;
      let final = "";
      const onToken = (full: string) => {
        const st = useV2.getState();
        if (full) {
          if (st.state === "thinking") st.setState("speaking");
          st.patchMessage(id, { text: full, simulated });
        }
      };

      try {
        if (isSpotifyRequest(text)) {
          const context = history
            .slice(0, -1)
            .slice(-8)
            .map((message) => `${message.role}: ${message.content}`)
            .join("\\n")
            .slice(-12_000);
          const response = await fetch("/api/agent-delegate", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task: text, context }),
            signal: ctrl.signal,
          });
          const payload = await response.json().catch(() => ({})) as {
            ok?: boolean;
            result?: string;
            message?: string;
          };
          if (!response.ok || !payload.ok || !payload.result) {
            throw new Error(payload.message || `No se pudo completar la orden de Spotify (HTTP ${response.status}).`);
          }
          final = payload.result;
        } else {
          try {
            final = await chat(history, {
              endpoint: s.aiEndpoint,
              model: s.aiModel,
              signal: ctrl.signal,
              onToken,
            });
            useV2.getState().setAutoConnect(true);
            useV2.getState().setLink(
              "online",
              "Qwen conectado. La reconexión automática quedó activada.",
            );
          } catch (e) {
            if ((e as Error).name === "AbortError") throw e;
            if (e instanceof AiUnreachable) {
              simulated = true;
              useV2.getState().setLink("offline", e.message);
              final = await simulate(text, ctrl.signal, onToken);
            } else {
              throw e;
            }
          }
        }
        const st = useV2.getState();
        st.patchMessage(id, { text: final, simulated });
        if (viaVoice || st.voiceReplies) {
          st.setState("speaking");
          stopSpeakRef.current = speak(
            final,
            (v) => useV2.getState().setAmplitude(v),
            () => {
              useV2.getState().setAmplitude(0);
              useV2.getState().setState("idle");
            },
            (reason) => {
              const current = useV2.getState();
              current.setAmplitude(0);
              current.patchMessage(id, { text: `${final}\n\nVoz: ${reason}` });
              current.setState("error");
            },
          );
        } else {
          st.setState("idle");
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const msg = e instanceof AiError ? e.message : e instanceof Error ? e.message : "No se pudo completar la respuesta.";
        const st = useV2.getState();
        st.patchMessage(id, { text: msg, error: true });
        st.setLink("offline", msg);
        st.setState("error");
        setTimeout(() => {
          if (useV2.getState().state === "error") useV2.getState().setState("idle");
        }, 2400);
      }
    },
    [stop],
  );

  return { send, stop };
}
