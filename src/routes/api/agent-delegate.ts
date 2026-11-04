import { createFileRoute } from "@tanstack/react-router";
import { NEMOTRON_MODEL, NEMOTRON_URL } from "@/lib/juspross/nemotronRequest";

const MAX_BODY = 32 * 1024;
const MAX_TASK = 8_000;
const MAX_CONTEXT = 12_000;
const bad = (message: string, status = 400) => Response.json({ message }, { status });

/** Puente servidor-servidor: Gemini Live delega análisis y planificación a Nemotron. */
export const Route = createFileRoute("/api/agent-delegate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) return bad("Solicitud no autorizada.", 403);
        if (!(request.headers.get("content-type") ?? "").includes("application/json")) return bad("Se esperaba JSON.", 415);
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return bad("Petición demasiado grande.", 413);
        const raw = await request.text().catch(() => "");
        if (raw.length > MAX_BODY) return bad("Petición demasiado grande.", 413);

        let input: unknown;
        try { input = JSON.parse(raw); } catch { return bad("JSON inválido."); }
        if (!input || typeof input !== "object") return bad("Petición inválida.");
        const body = input as Record<string, unknown>;
        const task = typeof body["task"] === "string" ? body["task"].trim() : "";
        const context = typeof body["context"] === "string" ? body["context"].trim() : "";
        if (!task || task.length > MAX_TASK) return bad("La tarea debe tener entre 1 y 8000 caracteres.");
        if (context.length > MAX_CONTEXT) return bad("El contexto es demasiado largo.");

        const key = process.env["NVIDIA_API_KEY"];
        if (!key) return bad("Falta configurar NVIDIA_API_KEY en los secretos del proyecto.", 500);
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
        try {
          const upstream = await fetch(NEMOTRON_URL, {
            method: "POST",
            signal,
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: NEMOTRON_MODEL,
              stream: false,
              max_tokens: 1024,
              messages: [
                {
                  role: "system",
                  content: [
                    "Eres Nemotron, el agente ejecutor y analista de Juspross.",
                    "Gemini Live es el interlocutor del usuario y te delega una tarea.",
                    "Analiza la petición y devuelve un plan operativo concreto, ordenado y verificable.",
                    "No afirmes haber abierto aplicaciones, modificado archivos ni realizado acciones externas: esta ruta todavía no dispone de herramientas de ejecución.",
                    "Identifica qué herramienta o permiso externo haría falta cuando una acción no pueda ejecutarse desde aquí.",
                    "Responde en español, con claridad y brevedad."
                  ].join(" ")
                },
                { role: "user", content: `TAREA DELEGADA:\n${task}\n\nCONTEXTO:\n${context || "Sin contexto adicional."}` }
              ]
            })
          });
          const payload = await upstream.json().catch(() => ({})) as {
            choices?: { message?: { content?: string | null } }[];
            error?: { message?: string };
          };
          if (!upstream.ok) {
            const detail = payload.error?.message?.slice(0, 220);
            return bad(`Nemotron respondió HTTP ${upstream.status}.${detail ? ` ${detail}` : ""}`, 502);
          }
          const result = payload.choices?.[0]?.message?.content?.trim();
          if (!result) return bad("Nemotron no devolvió un resultado utilizable.", 502);
          return Response.json({ ok: true, delegatedTo: NEMOTRON_MODEL, result }, {
            headers: { "Cache-Control": "no-store" }
          });
        } catch (error) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          const message = error instanceof Error ? error.message : "Error desconocido";
          return bad(`No se pudo completar la delegación a Nemotron: ${message.slice(0, 180)}`, 504);
        }
      }
    }
  }
});
