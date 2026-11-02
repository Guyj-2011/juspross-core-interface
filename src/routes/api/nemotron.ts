import { createFileRoute } from "@tanstack/react-router";
import { createSseParser, stripReasoning } from "@/lib/juspross/sse";
import {
  NEMOTRON_MODEL,
  NEMOTRON_URL,
  nemotronDelta,
  validateNemotronInput,
} from "@/lib/juspross/nemotronRequest";

/**
 * Proxy de chat hacia NVIDIA Nemotron. La clave NVIDIA_API_KEY solo se lee aquí,
 * en el servidor. Re-emite un SSE propio con solo el contenido final del asistente
 * (`data: {"t": "..."}`), descartando `reasoning_content` y bloques <think>.
 */
const MAX_BODY = 256 * 1024;
const TIMEOUT_MS = 120_000;
const bad = (message: string, status = 400) => Response.json({ message }, { status });

export const Route = createFileRoute("/api/nemotron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) return bad("Solicitud no autorizada.", 403);
        if (!(request.headers.get("content-type") ?? "").includes("application/json"))
          return bad("Se esperaba JSON.", 415);
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return bad("Petición demasiado grande.", 413);
        const raw = await request.text().catch(() => "");
        if (raw.length > MAX_BODY) return bad("Petición demasiado grande.", 413);
        let parsed: unknown = null;
        try { parsed = JSON.parse(raw); } catch { /* inválido */ }
        const v = validateNemotronInput(parsed);
        if (!v.ok) return bad(v.message);

        const key = process.env["NVIDIA_API_KEY"];
        if (!key) return bad("Falta configurar NVIDIA_API_KEY en los secretos del proyecto.", 500);

        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);
        let upstream: Response;
        try {
          upstream = await fetch(NEMOTRON_URL, {
            method: "POST",
            signal,
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify({ model: NEMOTRON_MODEL, stream: true, max_tokens: v.maxTokens, messages: v.messages }),
          });
        } catch {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return bad("No se pudo conectar con NVIDIA (sin respuesta o tiempo agotado).", 504);
        }
        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          let message = `NVIDIA respondió ${upstream.status}.`;
          try {
            const j = JSON.parse(text) as { detail?: string; message?: string; error?: { message?: string } };
            const m = j.error?.message ?? j.detail ?? j.message;
            if (m) message += ` ${String(m).slice(0, 200)}`;
          } catch { /* sin detalle seguro */ }
          const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
          return bad(upstream.status === 401 ? "NVIDIA rechazó la clave configurada (401)." : message, status);
        }

        const enc = new TextEncoder();
        const reader = upstream.body.getReader();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
            let acc = "";
            let emitted = "";
            let finished = false;
            const parser = createSseParser((data) => {
              if (finished) return;
              const d = nemotronDelta(data);
              if (d.error) { send({ error: d.error }); finished = true; return; }
              if (d.done) { finished = true; return; }
              if (!d.content) return;
              acc += d.content;
              const visible = stripReasoning(acc);
              if (visible.length > emitted.length && visible.startsWith(emitted)) {
                send({ t: visible.slice(emitted.length) });
                emitted = visible;
              }
            });
            const dec = new TextDecoder();
            try {
              while (!finished) {
                const { done, value } = await reader.read();
                if (done) break;
                parser.push(dec.decode(value, { stream: true }));
              }
              parser.end();
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
            } catch {
              if (!request.signal.aborted) send({ error: "Se interrumpió la respuesta de NVIDIA." });
            } finally {
              reader.cancel().catch(() => {});
              try { controller.close(); } catch { /* ya cerrado */ }
            }
          },
          cancel() { reader.cancel().catch(() => {}); },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
        });
      },
    },
  },
});
