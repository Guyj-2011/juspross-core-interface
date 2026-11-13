import { createFileRoute } from "@tanstack/react-router";
import { NEMOTRON_MODEL, NEMOTRON_URL } from "@/lib/juspross/nemotronRequest";
import { executeSpotifyTool } from "@/lib/juspross/spotifyTools.server";

import { parseSpotifyCommands, runSpotifyCommands } from "@/lib/juspross/spotifyCommands";
import { claimSpotifyCommand } from "@/lib/juspross/spotifyReceipt.server";

const MAX_BODY = 32 * 1024;
const MAX_TASK = 8_000;
const MAX_CONTEXT = 12_000;
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
        if (!origin || origin !== new URL(request.url).origin)
          return bad("Solicitud no autorizada.", 403);
        if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json"))
          return bad("Se esperaba JSON.", 415);
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
          return bad("Petición demasiado grande.", 413);
        const raw = await request.text().catch(() => "");
        if (raw.length > MAX_BODY) return bad("Petición demasiado grande.", 413);

        let input: unknown;
        try {
          input = JSON.parse(raw);
        } catch {
          return bad("JSON inválido.");
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          return bad("Petición inválida.");
        const body = input as Record<string, unknown>;
        const task = typeof body["task"] === "string" ? body["task"].trim() : "";
        const context = typeof body["context"] === "string" ? body["context"].trim() : "";
        const voiceIntent = typeof body["intent"] === "string" ? body["intent"] : "auto";
        const normalizedTask = task
          .toLocaleLowerCase("es")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        const openOnly =
          body["intent"] === "open_spotify_desktop" ||
          (/\b(abre|abrir|inicia|iniciar|lanza|lanzar|arranca|arrancar|open|launch|start)\b/.test(
            normalizedTask,
          ) &&
            /\bspotify\b/.test(normalizedTask) &&
            !/\b(reproduc\w*|pon|play|pausa\w*|siguiente|anterior|reanuda\w*|cancion|tema|playlist|musica|artista)\b/.test(
              normalizedTask,
            ));
        if (!task || task.length > MAX_TASK)
          return bad("La tarea debe tener entre 1 y 8000 caracteres.");
        if (context.length > MAX_CONTEXT) return bad("El contexto es demasiado largo.");
        if (openOnly)
          return Response.json(
            {
              ok: true,
              action: "open_spotify_desktop",
              result: "Solicitud de apertura enviada al agente local.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        const commands = parseSpotifyCommands(task, voiceIntent);
        if (commands) {
          const requestId =
            typeof body["requestId"] === "string"
              ? body["requestId"]
              : request.headers.get("idempotency-key");
          if (!requestId || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId))
            return bad(
              "Falta un identificador seguro de orden. Vuelve a enviar la petición desde Juspross.",
            );
          const headers = new Headers({ "Cache-Control": "no-store" });
          try {
            const claim = await claimSpotifyCommand(request, requestId, commands);
            if (claim.setCookie) headers.append("Set-Cookie", claim.setCookie);
            if (claim.duplicate) {
              if (claim.outcome) return Response.json(claim.outcome, { headers });
              return Response.json(
                {
                  ok: false,
                  message:
                    "Esta orden ya fue enviada y su resultado es incierto o sigue en curso. No la ejecutaré dos veces.",
                },
                { status: 409, headers },
              );
            }
            const execution = await runSpotifyCommands(commands, (command) =>
              executeSpotifyTool(request, command.name, command.args),
            );
            for (const result of execution.results)
              if (result.setCookie) headers.set("Set-Cookie", result.setCookie);
            const summary = execution.results.map((r) => r.message).join(" ");
            const outcome = {
              ok: execution.ok,
              result: execution.ok ? summary : null,
              message: execution.ok ? null : summary,
              executedTools: commands.slice(0, execution.results.length).map((c) => c.name),
            };
            await claim.complete(outcome);
            return Response.json(outcome, { status: execution.ok ? 200 : 502, headers });
          } catch (error) {
            return Response.json(
              {
                ok: false,
                message:
                  error instanceof Error
                    ? error.message
                    : "No pude ejecutar la orden de forma segura.",
              },
              { status: 502, headers },
            );
          }
        }
        // Spotify never goes through a reasoning model on an ambiguous request.
        if (
          voiceIntent !== "auto" ||
          /spotify|\b(?:pon|pausa|play|volumen|cancion|siguiente|anterior|retrocede)\b/.test(
            normalizedTask,
          )
        ) {
          return bad(
            "No identifiqué con seguridad todas las acciones. ¿Qué canción o controles de Spotify quieres usar?",
          );
        }

        const key = process.env["NVIDIA_API_KEY"];
        if (!key) return bad("Falta configurar NVIDIA_API_KEY en los secretos del proyecto.", 500);

        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
        const messages: Record<string, unknown>[] = [
          {
            role: "system",
            content: [
              "Eres Nemotron, el agente de razonamiento complejo de Juspross. Responde en español de forma clara y breve.",
              "No ejecutes acciones de Spotify ni afirmes resultados de herramientas. No inventes búsquedas actuales en internet.",
              "Analiza únicamente la tarea no relacionada con Spotify que recibas. No reveles razonamiento privado.",
            ].join(" "),
          },
          {
            role: "user",
            content: `TAREA DELEGADA:\n${task}\n\nCONTEXTO:\n${context || "Sin contexto adicional."}`,
          },
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

                tool_choice: "none",
                messages,
              }),
            });
            const payload = (await upstream.json().catch(() => ({}))) as {
              choices?: { message?: NemotronMessage }[];
              error?: { message?: string };
            };
            if (!upstream.ok) {
              const detail = payload.error?.message?.slice(0, 220);
              return bad(
                `Nemotron respondió HTTP ${upstream.status}.${detail ? ` ${detail}` : ""}`,
                502,
              );
            }

            const assistant = payload.choices?.[0]?.message;
            if (!assistant) return bad("Nemotron no devolvió una respuesta utilizable.", 502);
            const calls = assistant.tool_calls ?? [];
            if (calls.length)
              return bad("Las acciones de Spotify deben pedirse por su herramienta directa.", 400);
            if (calls.length === 0) {
              const result = assistant.content?.trim();
              if (!result) return bad("Nemotron no devolvió una respuesta utilizable.", 502);
              const headers = new Headers({ "Cache-Control": "no-store" });
              if (refreshedCookie) headers.append("Set-Cookie", refreshedCookie);
              return Response.json({ ok: true, delegatedTo: NEMOTRON_MODEL, result }, { headers });
            }
          }
          return bad("Nemotron no pudo terminar la tarea.", 502);
        } catch (error) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          const message = error instanceof Error ? error.message : "Error desconocido";
          return bad(
            `No se pudo completar la delegación a Nemotron: ${message.slice(0, 180)}`,
            504,
          );
        }
      },
    },
  },
});
