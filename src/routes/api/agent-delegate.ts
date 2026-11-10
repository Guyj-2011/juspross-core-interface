import { createFileRoute } from "@tanstack/react-router";
import { NEMOTRON_MODEL, NEMOTRON_URL } from "@/lib/juspross/nemotronRequest";
import { executeSpotifyTool, SPOTIFY_TOOL_DEFINITIONS } from "@/lib/juspross/spotifyTools.server";

const MAX_BODY = 32 * 1024;
const MAX_TASK = 8_000;
const MAX_CONTEXT = 12_000;
const ALLOWED_TOOLS: ReadonlySet<string> = new Set(SPOTIFY_TOOL_DEFINITIONS.map((tool) => tool.function.name));
const bad = (message: string, status = 400) => Response.json({ message }, { status });

type ToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type NemotronMessage = {
  content?: string | null;
  tool_calls?: ToolCall[];
};

export const Route = createFileRoute("/api/agent-delegate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (!origin || origin !== new URL(request.url).origin) {
          return bad("Solicitud no autorizada.", 403);
        }
        if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
          return bad("Se esperaba JSON.", 415);
        }
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
          return bad("Petición demasiado grande.", 413);
        }
        const raw = await request.text().catch(() => "");
        if (raw.length > MAX_BODY) return bad("Petición demasiado grande.", 413);

        let input: unknown;
        try {
          input = JSON.parse(raw);
        } catch {
          return bad("JSON inválido.");
        }
        if (!input || typeof input !== "object" || Array.isArray(input)) return bad("Petición inválida.");
        const body = input as Record<string, unknown>;
        const task = typeof body["task"] === "string" ? body["task"].trim() : "";
        const context = typeof body["context"] === "string" ? body["context"].trim() : "";
        if (!task || task.length > MAX_TASK) return bad("La tarea debe tener entre 1 y 8000 caracteres.");
        if (context.length > MAX_CONTEXT) return bad("El contexto es demasiado largo.");

        const key = process.env["NVIDIA_API_KEY"];
        if (!key) return bad("Falta configurar NVIDIA_API_KEY en los secretos del servidor.", 500);

        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
        const messages: Record<string, unknown>[] = [
          {
            role: "system",
            content: [
              "Eres Nemotron, el agente ejecutor de Juspross. El interlocutor principal es Juspross.",
              "Puedes utilizar exclusivamente las herramientas Spotify declaradas cuando el usuario pida controlar o reproducir música.",
              "Para reproducir una canción o artista usa spotify_search_and_play con kind=track; para una playlist usa kind=playlist.",
              "Para pausar, reanudar, avanzar o retroceder usa la herramienta correspondiente.",
              "No afirmes que una acción se realizó hasta recibir una respuesta exitosa de la herramienta.",
              "Si Spotify no está conectado, indica que el usuario debe conectarlo desde Ajustes. Si no hay dispositivo activo, indícale que abra Spotify en un dispositivo.",
              "La API de Spotify no abre la aplicación de escritorio; no afirmes que puedes abrirla.",
              "No solicites credenciales ni inventes resultados del catálogo. Cuando la herramienta de estado devuelva canción y artista actuales, puedes comunicarlos al usuario.",
              "No ejecutes acciones ajenas a Spotify en esta delegación.",
              "Responde siempre en español, de forma clara y breve.",
            ].join(" "),
          },
          { role: "user", content: `TAREA DELEGADA:\n${task}\n\nCONTEXTO:\n${context || "Sin contexto adicional."}` },
        ];

        let refreshedCookie: string | undefined;
        try {
          for (let round = 0; round < 5; round++) {
            const upstream = await fetch(NEMOTRON_URL, {
              method: "POST",
              signal,
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: NEMOTRON_MODEL,
                stream: false,
                temperature: 0.2,
                max_tokens: 1200,
                tools: SPOTIFY_TOOL_DEFINITIONS,
                tool_choice: "auto",
                messages,
              }),
            });
            const payload = await upstream.json().catch(() => ({})) as {
              choices?: { message?: NemotronMessage }[];
              error?: { message?: string };
            };
            if (!upstream.ok) {
              const detail = payload.error?.message?.slice(0, 180);
              return bad(`Nemotron respondió HTTP ${upstream.status}.${detail ? ` ${detail}` : ""}`, 502);
            }

            const assistant = payload.choices?.[0]?.message;
            if (!assistant) return bad("Nemotron no devolvió una respuesta utilizable.", 502);
            const calls = assistant.tool_calls ?? [];
            if (calls.length === 0) {
              const result = assistant.content?.trim();
              if (!result) return bad("Nemotron no devolvió un resultado utilizable.", 502);
              const headers = new Headers({ "Cache-Control": "no-store" });
              if (refreshedCookie) headers.append("Set-Cookie", refreshedCookie);
              return Response.json({ ok: true, delegatedTo: NEMOTRON_MODEL, result }, { headers });
            }

            if (round === 4) {
              return bad("Nemotron alcanzó el límite de pasos de herramientas. Inténtalo con una petición más concreta.", 502);
            }
            messages.push({
              role: "assistant",
              content: assistant.content ?? "",
              tool_calls: calls,
            });

            for (const [callIndex, call] of calls.entries()) {
              if (!call.id) continue;
              if (callIndex >= 3) {
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: JSON.stringify({ ok: false, message: "Se alcanzó el límite de llamadas de herramientas por turno." }),
                });
                continue;
              }
              const name = call.function?.name ?? "";
              if (call.type !== "function" || !ALLOWED_TOOLS.has(name)) {
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: JSON.stringify({ ok: false, message: "Herramienta no permitida." }),
                });
                continue;
              }
              let args: Record<string, unknown>;
              try {
                const parsed: unknown = JSON.parse(call.function?.arguments ?? "{}");
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
                args = parsed as Record<string, unknown>;
              } catch {
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: JSON.stringify({ ok: false, message: "Los argumentos de la herramienta no son JSON válido." }),
                });
                continue;
              }
              const result = await executeSpotifyTool(request, name, args);
              if (result.setCookie) refreshedCookie = result.setCookie;
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({ ok: result.ok, message: result.message }),
              });
            }
          }
          return bad("Nemotron no pudo terminar la tarea.", 502);
        } catch (error) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          const message = error instanceof Error ? error.message : "Error desconocido";
          return bad(`No se pudo completar la delegación a Nemotron: ${message.slice(0, 160)}`, 504);
        }
      },
    },
  },
});
