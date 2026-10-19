/**
 * Cliente de la API de Agnes (vía /api/agnes, que reenvía a apihub.agnes-ai.com).
 * Solo se usan los modelos que Agnes anunció como gratuitos.
 */
export type MediaKind = "image" | "video";

export const FREE_MODELS = {
  text: "agnes-2.0-flash",
  image: "agnes-image-2.1-flash",
  video: "agnes-video-v2.0",
} as const;

export const IMAGE_PRESETS = [
  { id: "square", label: "Cuadrada 1:1", size: "1024x1024" },
  { id: "wide", label: "Horizontal 16:9", size: "1280x720" },
  { id: "tall", label: "Vertical 9:16", size: "720x1280" },
  { id: "classic", label: "Clásica 4:3", size: "1024x768" },
] as const;

export const VIDEO_PRESETS = [
  { id: "wide", label: "Horizontal 3:2", w: 1152, h: 768 },
  { id: "w169", label: "Horizontal 16:9", w: 1024, h: 576 },
  { id: "tall", label: "Vertical 2:3", w: 768, h: 1152 },
  { id: "t916", label: "Vertical 9:16", w: 576, h: 1024 },
  { id: "sq", label: "Cuadrado", w: 768, h: 768 },
] as const;

export const VIDEO_DURATIONS = [
  { id: "3", label: "3 s", frames: 81, seconds: 3.4 },
  { id: "5", label: "5 s", frames: 121, seconds: 5 },
] as const;

export class AgnesError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Mensaje original de Agnes (útil para saber el motivo real). */
    public detail = "",
  ) {
    super(message);
  }
}

const RETRY = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function friendly(status: number, msg: string): string {
  if (status === 401) return "Agnes no aceptó la clave. Revisa que esté bien copiada.";
  if (status === 429) {
    const why = msg && msg.length < 200 ? ` Agnes dice: «${msg}»` : "";
    return `Agnes está limitando el ritmo ahora mismo (plan gratis). Espera un minuto e inténtalo otra vez.${why}`;
  }
  if (status === 403) return msg || "Acceso no permitido.";
  if (status === 404) return "Agnes no encontró el recurso pedido.";
  if (status >= 500) return "Agnes está ocupado ahora mismo. Inténtalo de nuevo en un momento.";
  return msg || `Error ${status}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function call(
  op: string,
  key: string,
  body: object,
  signal?: AbortSignal,
  retries = 3,
): Promise<Any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch("/api/agnes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, key, ...body }),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new AgnesError("No hay conexión con el servidor.", 0);
    }
    if (res.ok) return res.json();
    const raw = await res.text();
    let msg = raw;
    try {
      const j = JSON.parse(raw) as Any;
      msg = j?.message ?? j?.error?.message ?? j?.detail ?? raw;
    } catch {
      /* texto plano */
    }
    if (RETRY.has(res.status) && attempt < retries) {
      // en 429 se espera más (y se respeta Retry-After) para no empeorar el límite
      const ra = Number(res.headers.get("retry-after")) * 1000;
      const base = res.status === 429 ? 8000 : 1500;
      await sleep(
        Math.min(60_000, Math.max(Number.isFinite(ra) ? ra : 0, base * 2 ** attempt)),
        signal,
      );
      continue;
    }
    throw new AgnesError(
      friendly(res.status, String(msg).slice(0, 240)),
      res.status,
      String(msg).slice(0, 240),
    );
  }
}

export interface PingResult {
  /** Agnes respondió que está limitando el ritmo: la clave parece válida pero no se pudo verificar del todo. */
  limited: boolean;
  /** Modelos que lista la cuenta (si Agnes los devolvió). */
  models: string[];
}

/** Comprueba la clave sin reintentos agresivos: primero la lista de modelos y, si no existe, un mensaje mínimo. */
export async function pingAgnes(key: string): Promise<PingResult> {
  try {
    const r = await call("models", key, {}, undefined, 0);
    const models = ((r?.data ?? r?.models ?? []) as Any[])
      .map((m) => String(m?.id ?? m?.name ?? ""))
      .filter(Boolean);
    return { limited: false, models };
  } catch (e) {
    if (!(e instanceof AgnesError)) throw e;
    if (e.status === 401) throw e;
    if (e.status === 429) return { limited: true, models: [] };
    if (![400, 404, 405].includes(e.status)) throw e;
  }
  try {
    await call("ping", key, {}, undefined, 0);
    return { limited: false, models: [] };
  } catch (e) {
    if (e instanceof AgnesError && e.status === 429) return { limited: true, models: [] };
    throw e;
  }
}

const stripThink = (t: string) =>
  t
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();

/** Convierte lo que escribes (en cualquier idioma, o un ajuste como "hazlo más oscuro") en un prompt en inglés. */
export async function polishPrompt(
  key: string,
  kind: MediaKind,
  history: { role: "user" | "assistant"; content: string }[],
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const what =
    kind === "image"
      ? "a text-to-image model. Include concrete visual details: subject, style, lighting, composition."
      : "a text-to-video model. Include the subject, the action and motion, the camera movement, lighting and atmosphere.";
  const system =
    `You rewrite the user's request (in any language) as ONE detailed English prompt for ${what} ` +
    "Keep the user's intent. If the user is asking to change or refine the previous result, apply that change to the previous prompt. " +
    "Output ONLY the final prompt, at most 90 words, no quotes and no explanations.";
  const res = await call(
    "chat",
    key,
    {
      messages: [
        { role: "system", content: system },
        ...history.slice(-6),
        { role: "user", content: text },
      ],
      max_tokens: 220,
    },
    signal,
    1,
  );
  const out = stripThink(String(res?.choices?.[0]?.message?.content ?? "")).replace(
    /^["'`]+|["'`]+$/g,
    "",
  );
  return out.slice(0, 1800);
}

function b64ToBlob(b64: string): Blob {
  const clean = b64.replace(/^data:[^,]+,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const mime = bytes[0] === 0xff ? "image/jpeg" : bytes[0] === 0x52 ? "image/webp" : "image/png";
  return new Blob([bytes], { type: mime });
}

export async function downloadBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch("/api/agnes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "download", url }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new AgnesError("No se pudo descargar el resultado.", res.status);
  return res.blob();
}

let lastImage = 0;
/** Espera lo necesario para respetar el ritmo del plan gratis (imágenes de ~1K: 20 por minuto). */
export async function waitImageSlot(signal?: AbortSignal) {
  const wait = 3000 - (Date.now() - lastImage);
  if (wait > 0) await sleep(wait, signal);
  lastImage = Date.now();
}

export async function generateImage(
  key: string,
  prompt: string,
  size: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; remoteUrl?: string }> {
  let res: Any;
  try {
    res = await call("image", key, { prompt, size, response_format: "b64_json" }, signal);
  } catch (e) {
    if (e instanceof AgnesError && e.status === 400) {
      res = await call("image", key, { prompt, size, response_format: "url" }, signal);
    } else throw e;
  }
  const d = res?.data?.[0];
  if (d?.b64_json) return { blob: b64ToBlob(String(d.b64_json)) };
  if (typeof d?.url === "string") {
    try {
      return { blob: await downloadBlob(d.url, signal), remoteUrl: d.url };
    } catch {
      throw new AgnesError("La imagen se creó pero no se pudo descargar.", 502);
    }
  }
  throw new AgnesError("Agnes no devolvió ninguna imagen. Prueba con otra descripción.", 502);
}

const VIDEO_GAP_MS = 65_000;
const LS_VID = "juspross.agnes.lastVideo";
/** El plan gratis permite 1 video por minuto: milisegundos que faltan para poder pedir otro. */
export function videoCooldownMs(): number {
  try {
    const last = Number(localStorage.getItem(LS_VID) ?? 0);
    return Math.max(0, VIDEO_GAP_MS - (Date.now() - last));
  } catch {
    return 0;
  }
}
function markVideoUsed() {
  try {
    localStorage.setItem(LS_VID, String(Date.now()));
  } catch {
    /* sin almacenamiento */
  }
}

export async function createVideo(
  key: string,
  prompt: string,
  size: { w: number; h: number },
  frames: number,
  signal?: AbortSignal,
): Promise<string> {
  const res = await call(
    "video_create",
    key,
    { prompt, width: size.w, height: size.h, num_frames: frames },
    signal,
  );
  markVideoUsed();
  const id = res?.video_id ?? res?.id ?? res?.data?.video_id ?? res?.data?.id ?? res?.task_id;
  if (typeof id !== "string" || !id)
    throw new AgnesError("Agnes no devolvió el identificador del video.", 502);
  return id;
}

const firstUrl = (o: Any): string | null => {
  if (!o || typeof o !== "object") return null;
  for (const k of ["video_url", "url", "remixed_from_video_id"]) {
    const v = o[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
};

/** Consulta el video cada pocos segundos hasta que esté listo y devuelve su dirección. */
export async function pollVideo(
  key: string,
  videoId: string,
  onTick: (elapsedSec: number, status: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < 15 * 60_000) {
    await sleep(6000, signal);
    const res = await call("video_status", key, { video_id: videoId }, signal);
    const status = String(res?.status ?? res?.data?.status ?? "").toLowerCase();
    const url = firstUrl(res) ?? firstUrl(res?.data);
    onTick(Math.round((Date.now() - start) / 1000), status);
    if (url && (!status || ["completed", "success", "succeeded", "done"].includes(status)))
      return url;
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new AgnesError(
        String(res?.error?.message ?? res?.message ?? "Agnes no pudo crear el video."),
        502,
      );
    }
  }
  throw new AgnesError("El video tardó demasiado. Inténtalo de nuevo más tarde.", 504);
}
