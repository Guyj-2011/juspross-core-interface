import { createFileRoute } from "@tanstack/react-router";

/**
 * Puente hacia la API de Agnes (https://apihub.agnes-ai.com).
 *  - La clave la manda el navegador en cada petición; aquí no se guarda ni se registra.
 *  - Solo se permiten los modelos que Agnes anunció como gratuitos y tamaños moderados,
 *    así que aunque alguien manipule el cliente no se puede llamar a otro modelo.
 */
const BASE = "https://apihub.agnes-ai.com";
const FREE = {
  text: "agnes-2.0-flash",
  image: "agnes-image-2.1-flash",
  video: "agnes-video-v2.0",
} as const;
const IMAGE_SIZES = new Set(["1024x1024", "1280x720", "720x1280", "1024x768", "768x1024"]);
const VIDEO_SIZES = new Set(["1152x768", "768x1152", "1024x576", "576x1024", "768x768"]);
const VIDEO_FRAMES = new Set([81, 121]); // ~3 s o ~5 s a 24 fps
const DOWNLOAD_HOSTS = [
  /^https:\/\/storage\.googleapis\.com\/agnes-aigc\//,
  /^https:\/\/platform-outputs\.agnes-ai\.space\//,
  /^https:\/\/[a-z0-9.-]+\.agnes-ai\.(com|cn|space)\//,
];

type Json = Record<string, unknown>;
const bad = (message: string, status = 400) => Response.json({ message }, { status });
const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

async function forward(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    const up = await fetch(url, { ...init, signal });
    const text = await up.text();
    return new Response(text, {
      status: up.status,
      headers: {
        "Content-Type": up.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    if (signal.aborted) return new Response(null, { status: 499 });
    return bad("No se pudo conectar con Agnes. Inténtalo de nuevo en un momento.", 502);
  }
}

export const Route = createFileRoute("/api/agnes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
          return bad("Solicitud no autorizada.", 403);
        const input = (await request.json().catch(() => null)) as Json | null;
        if (!input) return bad("Petición inválida.");
        const op = input["op"];

        // descarga de resultados (imágenes/videos) desde los servidores de Agnes, sin CORS
        if (op === "download") {
          const url = str(input["url"], 2000);
          if (!url || !DOWNLOAD_HOSTS.some((r) => r.test(url)))
            return bad("Dirección no permitida.", 403);
          try {
            const up = await fetch(url, { signal: request.signal });
            if (!up.ok || !up.body) return bad("No se pudo descargar el resultado.", 502);
            const len = Number(up.headers.get("content-length") ?? 0);
            if (len > 80_000_000) return bad("El archivo es demasiado grande.", 413);
            return new Response(up.body, {
              status: 200,
              headers: {
                "Content-Type": up.headers.get("content-type") ?? "application/octet-stream",
                "Cache-Control": "no-store",
              },
            });
          } catch {
            return bad("No se pudo descargar el resultado.", 502);
          }
        }

        const key = input["key"];
        if (typeof key !== "string" || key.length < 8 || key.length > 400 || /\s/.test(key)) {
          return bad("Falta una clave de Agnes válida.", 401);
        }
        const auth = { Authorization: `Bearer ${key}` };
        const post = (path: string, body: Json) =>
          forward(
            `${BASE}${path}`,
            {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            request.signal,
          );

        if (op === "ping" || op === "chat") {
          const raw = Array.isArray(input["messages"]) ? (input["messages"] as unknown[]) : [];
          const messages =
            op === "ping"
              ? [{ role: "user", content: "ping" }]
              : raw
                  .slice(-12)
                  .map((m) => m as Json)
                  .filter(
                    (m) =>
                      ["system", "user", "assistant"].includes(String(m["role"])) &&
                      str(m["content"], 4000),
                  )
                  .map((m) => ({ role: String(m["role"]), content: String(m["content"]) }));
          if (!messages.length) return bad("Falta el mensaje.");
          const maxTokens =
            op === "ping" ? 5 : Math.min(600, Math.max(16, Number(input["max_tokens"]) || 300));
          return post("/v1/chat/completions", {
            model: FREE.text,
            messages,
            max_tokens: maxTokens,
            temperature: 0.7,
            stream: false,
          });
        }

        if (op === "image") {
          const prompt = str(input["prompt"], 2000);
          const size = String(input["size"] ?? "1024x1024");
          if (!prompt) return bad("Falta la descripción de la imagen.");
          if (!IMAGE_SIZES.has(size)) return bad("Tamaño de imagen no permitido.");
          const fmt = input["response_format"] === "url" ? "url" : "b64_json";
          return post("/v1/images/generations", {
            model: FREE.image,
            prompt,
            size,
            response_format: fmt,
          });
        }

        if (op === "video_create") {
          const prompt = str(input["prompt"], 2000);
          const width = Number(input["width"]);
          const height = Number(input["height"]);
          const frames = Number(input["num_frames"]);
          if (!prompt) return bad("Falta la descripción del video.");
          if (!VIDEO_SIZES.has(`${width}x${height}`)) return bad("Tamaño de video no permitido.");
          if (!VIDEO_FRAMES.has(frames)) return bad("Duración de video no permitida.");
          const body: Json = {
            model: FREE.video,
            prompt,
            width,
            height,
            num_frames: frames,
            frame_rate: 24,
          };
          const neg = str(input["negative_prompt"], 500);
          if (neg) body["negative_prompt"] = neg;
          return post("/v1/videos", body);
        }

        if (op === "video_status") {
          const id = String(input["video_id"] ?? "");
          if (!/^[A-Za-z0-9_-]{6,160}$/.test(id)) return bad("Identificador de video inválido.");
          return forward(
            `${BASE}/agnesapi?video_id=${encodeURIComponent(id)}&model_name=${FREE.video}`,
            { method: "GET", headers: auth },
            request.signal,
          );
        }

        return bad("Operación no permitida.");
      },
    },
  },
});
