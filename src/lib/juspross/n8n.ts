/**
 * ── CAPA DE INTEGRACIÓN JUSPROSS ⇄ n8n ──────────────────────────────────────
 * Esta es la ÚNICA capa que habla con el backend. La UI nunca hace fetch.
 * Mientras no exista una webhook URL configurada, se usa el runner mock
 * (mockRun) que emite exactamente los mismos eventos que emitirá n8n.
 * Para conectar el backend real basta con guardar la URL en Ajustes.
 */
import type { AgentStatus } from "./types";

export interface JusprossRequest {
  message: string;
  type: "voice" | "text";
  timestamp: string;
  sessionId: string;
  files?: { name: string; size: number; kind: string }[];
}

export type JusprossEvent =
  | { kind: "agent"; agent: string; status: Lowercase<AgentStatus>; message: string }
  | { kind: "log"; agent: string; message: string; level?: "info" | "warn" | "error" | "done" }
  | { kind: "speak"; text: string }
  | { kind: "short"; title: string; stage: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export type EventSink = (e: JusprossEvent) => void;

export interface Transport {
  id: "mock" | "n8n";
  send(req: JusprossRequest, onEvent: EventSink, signal: AbortSignal): Promise<void>;
  test(): Promise<{ ok: boolean; ms: number; detail: string }>;
}

export function createN8nTransport(webhookUrl: string): Transport {
  return {
    id: "n8n",
    async test() {
      const t0 = performance.now();
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "ping", timestamp: new Date().toISOString() }),
        });
        return {
          ok: res.ok,
          ms: Math.round(performance.now() - t0),
          detail: `HTTP ${res.status}`,
        };
      } catch (e) {
        return {
          ok: false,
          ms: Math.round(performance.now() - t0),
          detail: e instanceof Error ? e.message : "network error",
        };
      }
    },
    async send(req, onEvent, signal) {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal,
      });
      if (!res.ok) {
        onEvent({ kind: "error", message: `n8n respondió ${res.status}` });
        return;
      }
      const ctype = res.headers.get("content-type") ?? "";
      // Streaming NDJSON / SSE de eventos de agentes
      if (res.body && (ctype.includes("stream") || ctype.includes("ndjson"))) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const clean = line.replace(/^data:\s*/, "").trim();
            if (!clean) continue;
            try {
              onEvent(normalize(JSON.parse(clean)));
            } catch {
              /* ignore malformed frame */
            }
          }
        }
        return;
      }
      const data = await res.json().catch(() => null);
      if (Array.isArray(data)) data.forEach((d) => onEvent(normalize(d)));
      else if (data) onEvent(normalize(data));
    },
  };
}

/** Traduce el payload crudo de n8n al evento interno. */
function normalize(raw: Record<string, unknown>): JusprossEvent {
  if (raw["agent"]) {
    return {
      kind: "agent",
      agent: String(raw["agent"]).toLowerCase(),
      status: String(raw["status"] ?? "active").toLowerCase() as Lowercase<AgentStatus>,
      message: String(raw["message"] ?? ""),
    };
  }
  if (raw["error"]) return { kind: "error", message: String(raw["error"]) };
  return { kind: "speak", text: String(raw["message"] ?? raw["text"] ?? "") };
}