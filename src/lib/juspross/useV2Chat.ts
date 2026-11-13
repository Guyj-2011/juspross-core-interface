import { useCallback, useEffect, useRef } from "react";
import { AiError, AiUnreachable, chat, chatGemma, chatNemotron, simulate, type AiMsg } from "./ai";
import { speak } from "./useSpeech";
import { unlockSpeechAudio } from "./speechAudio";
import { useV2 } from "./v2Store";
import { getSpotifyWindowAction, isOpenSpotifyIntent, isSpotifyRequest } from "./localIntent";
import { controlSpotifyWindow, describeLocalResult, describeSpotifyWindowResult, openSpotifyDesktop } from "./localAgent";

/** Conversación del lado 2.0: chat normal según el proveedor elegido; órdenes Spotify → Nemotron. */
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
    async (raw: string, viaVoice = false, visualContext = "") => {
      const text = raw.trim();
      if (!text) return;
      // Desbloquea Web Audio durante el clic de enviar, antes de esperar al modelo.
      unlockSpeechAudio();
      stop();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const s = useV2.getState();
      const history: AiMsg[] = s.messages
        .filter((m) => !m.error && m.text)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.text }));
      const context = history.slice(-8).map((message) => `${message.role}: ${message.content}`).join("\n").slice(-12_000);
      history.push({ role: "user", content: visualContext.trim()
        ? `${text}\n\nCONTEXTO VISUAL RECIENTE DE LA PANTALLA COMPARTIDA (puede haber cambiado):\n${visualContext.trim().slice(0, 1800)}`
        : text });

      s.addMessage({ role: "user", text });
      const id = s.addMessage({ role: "assistant", text: "" });
      s.setState("thinking");

      const spotifyTask = isSpotifyRequest(text, context);
      const spotifyWindowAction = getSpotifyWindowAction(text, context);
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
        if (spotifyWindowAction) {
          const localResult = await controlSpotifyWindow(spotifyWindowAction);
          if (ctrl.signal.aborted) return;
          final = describeSpotifyWindowResult(spotifyWindowAction, localResult);
        } else if (spotifyTask) {
          const response = await fetch("/api/agent-delegate", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task: text, context, intent: isOpenSpotifyIntent(text) ? "open_spotify_desktop" : undefined }),
            signal: ctrl.signal,
          });
          const payload = await response.json().catch(() => ({})) as {
            ok?: boolean;
            result?: string;
            action?: string;
            message?: string;
          };
          if (!response.ok || !payload.ok) {
            throw new Error(payload.message || `No se pudo completar la orden de Spotify (HTTP ${response.status}).`);
          }

          if (payload.action === "open_spotify_desktop") {
            // Nemotron elige la herramienta; el navegador la ejecuta en el PC
            // mediante el agente local emparejado (el servidor cloud no puede abrir apps locales).
            const localResult = await openSpotifyDesktop();
            if (ctrl.signal.aborted) return;
            final = describeLocalResult(localResult);
          } else if (payload.result) {
            final = payload.result;
          } else {
            throw new Error("Nemotron no devolvió un resultado para la orden de Spotify.");
          }
        } else {
          try {
            final =
              s.aiProvider === "nemotron"
                ? await chatNemotron(history, { signal: ctrl.signal, onToken })
                : s.aiProvider === "gemma"
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
              s.aiProvider === "nemotron"
                ? "Nemotron (NVIDIA) respondió correctamente."
                : s.aiProvider === "gemma"
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
        if (!spotifyTask) st.setLink("offline", msg);
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
