import { useCallback, useEffect, useRef } from "react";
import { AiError, AiUnreachable, chat, chatGemma, simulate, type AiMsg } from "./ai";
import { speak } from "./useSpeech";
import { useV2 } from "./v2Store";

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
        try {
          final =
            s.aiProvider === "gemma"
              ? await chatGemma(history, {
                  endpoint: s.gemmaEndpoint,
                  model: s.gemmaModel,
                  signal: ctrl.signal,
                  onToken,
                })
              : await chat(history, {
                  endpoint: s.aiEndpoint,
                  model: s.aiModel,
                  signal: ctrl.signal,
                  onToken,
                });
          useV2.getState().setAutoConnect(true);
          useV2.getState().setLink(
            "online",
            s.aiProvider === "gemma"
              ? "Gemma conectado. La reconexión automática quedó activada."
              : "Qwen conectado. La reconexión automática quedó activada.",
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
        const msg = e instanceof AiError ? e.message : "No se pudo completar la respuesta.";
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
