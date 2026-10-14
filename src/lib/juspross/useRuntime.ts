import { useCallback, useEffect, useRef } from "react";
import { jp, useJuspross } from "./store";
import { createN8nTransport, type JusprossEvent, type Transport } from "./n8n";
import { createMockTransport } from "./mockTransport";
import { cue } from "./audio";
import { speakCalm } from "./useSpeech";

const SESSION_ID = Math.random().toString(36).slice(2, 12);

function transport(): Transport {
  const url = jp().webhookUrl.trim();
  return url ? createN8nTransport(url) : createMockTransport();
}

export function useRuntime() {
  const abortRef = useRef<AbortController | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("juspross.webhook") : null;
    if (saved) useJuspross.setState({ webhookUrl: saved });
  }, []);

  const stopSpeaking = useCallback(() => {
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    const s = jp();
    if (s.systemState === "speaking") s.setState("idle", "STANDBY");
  }, []);

  const applyEvent = useCallback((e: JusprossEvent) => {
    const s = jp();
    s.pushDebug({ direction: "in", label: `event:${e.kind}`, payload: e });
    switch (e.kind) {
      case "agent": {
        const status = e.status.toUpperCase() as "IDLE" | "ACTIVE" | "PROCESSING" | "COMPLETED" | "ERROR";
        s.updateAgent(e.agent, { status, activity: e.message });
        s.log(e.agent.toUpperCase(), e.message, status === "COMPLETED" ? "done" : "info");
        if (status === "PROCESSING" || status === "ACTIVE") s.setState("processing", "PROCESSING");
        break;
      }
      case "log":
        s.log(e.agent, e.message, e.level ?? "info");
        break;
      case "speak": {
        s.addMessage({ role: "juspross", text: e.text, channel: "voice" });
        s.setState("speaking", "SPEAKING");
        stopSpeakRef.current = speakCalm(
          e.text,
          (v) => jp().setAmplitude(v),
          () => {
            const st = jp();
            st.setAmplitude(0);
            st.setState("success", "SUCCESS");
            cue("complete", st.soundEnabled);
            setTimeout(() => {
              if (jp().systemState === "success") jp().setState("idle", "STANDBY");
            }, 1400);
          },
          (reason) => {
            const st = jp();
            st.setAmplitude(0);
            st.setError(reason);
            st.setState("error", "ERROR DE VOZ");
            st.log("VOZ", reason, "error");
          },
        );
        break;
      }
      case "done":
        s.log("SISTEMA", e.message, "done");
        break;
      case "error":
        s.setError(e.message);
        s.setState("error", "ERROR");
        s.log("SISTEMA", e.message, "error");
        cue("error", s.soundEnabled);
        break;
    }
  }, []);

  const submit = useCallback(
    async (message: string, channel: "voice" | "text", files: { name: string; size: number; kind: string }[] = []) => {
      const text = message.trim();
      if (!text) return;
      stopSpeaking();
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const s = jp();
      s.setError(null);
      s.resetAgents();
      s.addMessage({ role: "user", text, channel, files });
      s.setTranscript("");
      s.setState("thinking", "THINKING");
      cue("activate", s.soundEnabled);
      s.log("DIRECTOR", "Solicitud recibida");

      const req = {
        message: text,
        type: channel,
        timestamp: new Date().toISOString(),
        sessionId: SESSION_ID,
        ...(files.length ? { files } : {}),
      };
      const tr = transport();
      s.pushDebug({ direction: "out", label: `${tr.id}:request`, payload: req });
      const t0 = performance.now();
      try {
        await tr.send(req, applyEvent, ctrl.signal);
        s.pushDebug({
          direction: "in",
          label: `${tr.id}:complete`,
          payload: { ok: true },
          ms: Math.round(performance.now() - t0),
          ok: true,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Fallo de comunicación";
        applyEvent({ kind: "error", message: `No se pudo completar la operación — ${msg}` });
        jp().pushDebug({
          direction: "in",
          label: `${tr.id}:failed`,
          payload: { error: msg },
          ms: Math.round(performance.now() - t0),
          ok: false,
        });
      }
    },
    [applyEvent, stopSpeaking],
  );

  const testConnection = useCallback(async () => {
    const s = jp();
    s.setConnection("checking");
    const tr = transport();
    s.pushDebug({ direction: "out", label: `${tr.id}:test`, payload: { url: s.webhookUrl || "(mock)" } });
    const res = await tr.test();
    s.setConnection(res.ok ? "online" : "offline");
    s.pushDebug({ direction: "in", label: `${tr.id}:test`, payload: res, ms: res.ms, ok: res.ok });
    s.log("SISTEMA", res.ok ? "JUSPROSS CONNECTED" : `JUSPROSS OFFLINE — ${res.detail}`, res.ok ? "done" : "warn");
    return res;
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    stopSpeaking();
    jp().setState("idle", "STANDBY");
  }, [stopSpeaking]);

  return { submit, testConnection, abort, stopSpeaking };
}