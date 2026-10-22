/**
 * Construye (y valida) las peticiones permitidas hacia la API de Agnes.
 * Lo usan tanto el navegador (ruta directa) como el servidor de la app (ruta de respaldo), así las dos
 * aplican exactamente las mismas barreras: solo modelos gratuitos y tamaños moderados.
 */
export const AGNES_BASE = "https://apihub.agnes-ai.com";

export const FREE = {
  text: "agnes-2.0-flash",
  image: "agnes-image-2.1-flash",
  video: "agnes-video-v2.0",
} as const;

const IMAGE_SIZES = new Set(["1024x1024", "1280x720", "720x1280", "1024x768", "768x1024"]);
const VIDEO_SIZES = new Set(["1152x768", "768x1152", "1024x576", "576x1024", "768x768"]);
const VIDEO_FRAMES = new Set([81, 121]); // ~3 s o ~5 s a 24 fps

type Json = Record<string, unknown>;
export interface Upstream {
  method: "GET" | "POST";
  path: string;
  body?: Json;
}
export type Built = { ok: true; up: Upstream } | { ok: false; status: number; message: string };

const fail = (message: string, status = 400): Built => ({ ok: false, status, message });
const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

export function buildUpstream(input: Json): Built {
  const op = input["op"];

  if (op === "models") return { ok: true, up: { method: "GET", path: "/v1/models" } };

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
    if (!messages.length) return fail("Falta el mensaje.");
    const maxTokens =
      op === "ping" ? 5 : Math.min(600, Math.max(16, Number(input["max_tokens"]) || 300));
    return {
      ok: true,
      up: {
        method: "POST",
        path: "/v1/chat/completions",
        body: {
          model: FREE.text,
          messages,
          max_tokens: maxTokens,
          temperature: 0.7,
          stream: false,
        },
      },
    };
  }

  if (op === "image") {
    const prompt = str(input["prompt"], 2000);
    const size = String(input["size"] ?? "1024x1024");
    if (!prompt) return fail("Falta la descripción de la imagen.");
    if (!IMAGE_SIZES.has(size)) return fail("Tamaño de imagen no permitido.");
    const fmt = input["response_format"] === "url" ? "url" : "b64_json";
    return {
      ok: true,
      up: {
        method: "POST",
        path: "/v1/images/generations",
        body: { model: FREE.image, prompt, size, response_format: fmt },
      },
    };
  }

  if (op === "video_create") {
    const prompt = str(input["prompt"], 2000);
    const width = Number(input["width"]);
    const height = Number(input["height"]);
    const frames = Number(input["num_frames"]);
    if (!prompt) return fail("Falta la descripción del video.");
    if (!VIDEO_SIZES.has(`${width}x${height}`)) return fail("Tamaño de video no permitido.");
    if (!VIDEO_FRAMES.has(frames)) return fail("Duración de video no permitida.");
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
    return { ok: true, up: { method: "POST", path: "/v1/videos", body } };
  }

  if (op === "video_status") {
    const id = String(input["video_id"] ?? "");
    if (!/^[A-Za-z0-9_-]{6,160}$/.test(id)) return fail("Identificador de video inválido.");
    return {
      ok: true,
      up: {
        method: "GET",
        path: `/agnesapi?video_id=${encodeURIComponent(id)}&model_name=${FREE.video}`,
      },
    };
  }

  return fail("Operación no permitida.");
}
