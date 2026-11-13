import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY = 2_200_000;
const VISION_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b";

function bad(message: string, status = 400) {
  return Response.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/vision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (!origin || origin !== new URL(request.url).origin) return bad("Solicitud no autorizada.", 403);
        if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
          return bad("Se esperaba JSON.", 415);
        }
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return bad("La imagen es demasiado grande.", 413);

        const raw = await request.text().catch(() => "");
        if (raw.length > MAX_BODY) return bad("La imagen es demasiado grande.", 413);

        let input: unknown;
        try { input = JSON.parse(raw); } catch { return bad("JSON inválido."); }
        if (!input || typeof input !== "object" || Array.isArray(input)) return bad("Petición inválida.");
        const image = (input as Record<string, unknown>)["image"];
        if (typeof image !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image)) {
          return bad("No se recibió un fotograma JPEG válido.");
        }

        const key = process.env["NVIDIA_API_KEY"];
        if (!key) return bad("Falta configurar NVIDIA_API_KEY en el servidor.", 503);

        try {
          const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(35_000)]),
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: VISION_MODEL,
              stream: false,
              temperature: 0.6,
              top_p: 0.95,
              max_tokens: 320,
              chat_template_kwargs: { enable_thinking: false },
              messages: [{
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Observa este fotograma de la pantalla completa del usuario. Describe brevemente qué aplicaciones y contenido visible aparecen y qué está ocurriendo. Si se ve un reproductor, identifica canción y artista solo si el texto es legible. No inventes detalles ni afirmes que algo ocurre si no se ve. No transcribas contraseñas, códigos, tokens ni datos personales sensibles. Responde en español en un máximo de 3 frases."
                  },
                  { type: "image_url", image_url: { url: image } }
                ]
              }]
            })
          });
          const payload = await upstream.json().catch(() => ({})) as {
            choices?: { message?: { content?: string | Array<{ type?: string; text?: string }> } }[];
            error?: { message?: string };
          };
          if (!upstream.ok) {
            const detail = payload.error?.message?.slice(0, 180);
            return bad(`El modelo visual respondió HTTP ${upstream.status}.${detail ? ` ${detail}` : ""}`, 502);
          }
          const rawContent = payload.choices?.[0]?.message?.content;
          const description = typeof rawContent === "string"
            ? rawContent.trim()
            : Array.isArray(rawContent)
              ? rawContent.map((part) => part.text ?? "").join("\n").trim()
              : "";
          if (!description) return bad("El modelo visual no devolvió una descripción.", 502);
          return Response.json(
            { ok: true, description, model: VISION_MODEL },
            { headers: { "Cache-Control": "no-store" } }
          );
        } catch (error) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          const message = error instanceof Error ? error.message : "Error desconocido";
          return bad(`No se pudo analizar la pantalla: ${message.slice(0, 160)}`, 504);
        }
      }
    }
  }
});
