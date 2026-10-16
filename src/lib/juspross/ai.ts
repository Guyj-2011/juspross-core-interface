/**
 * Cliente de IA del lado 2.0.
 * Habla con un modelo local (Qwen) a través de Ollama (http://localhost:11434).
 * Si no hay conexión, el llamador usa `simulate` para que la interfaz siga viva.
 */

export interface AiMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

/** El servidor respondió, pero con un error (modelo no instalado, etc.). */
export class AiError extends Error {}
/** No se pudo alcanzar el servidor (apagado, CORS, bloqueo del navegador). */
export class AiUnreachable extends Error {}

/**
 * Tell modern Chromium that this request intentionally targets the local
 * machine. This does not bypass CORS or Chrome's Local Network Access prompt;
 * it lets the browser classify localhost as a local-network request.
 */
type LocalRequestInit = RequestInit & { targetAddressSpace?: "local" };

function fetchLocal(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, targetAddressSpace: "local" } as LocalRequestInit);
}

function connectionHint(endpoint: string, error: unknown): string {
  const detail =
    error instanceof Error
      ? `${error.name}${error.message ? `: ${error.message}` : ""}`
      : String(error);
  const origin = typeof window !== "undefined" ? window.location.origin : "origen desconocido";
  return (
    `No se pudo leer la API de Ollama en ${endpoint}. Origen de Juspross: ${origin}. ` +
    `Comprueba que Ollama esté ejecutándose, que OLLAMA_ORIGINS incluya exactamente ese origen ` +
    `y que el navegador permita el acceso a la red local para este sitio. Detalle del navegador: ${detail}`
  );
}

export const SYSTEM_PROMPT =
  "Eres Juspross 2.0, una inteligencia artificial serena y precisa que vive dentro de un núcleo holográfico. " +
  "Responde siempre en español, de forma natural y breve (2 a 5 frases) salvo que te pidan más detalle.";

const clean = (t: string) =>
  t
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trimStart();

async function tags(endpoint: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchLocal(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(8000) });
  } catch (error) {
    throw new AiUnreachable(connectionHint(endpoint, error));
  }
  if (!res.ok) throw new AiError(`Ollama respondió ${res.status}`);
  const j = (await res.json()) as { models?: { name: string }[] };
  return (j.models ?? []).map((m) => m.name);
}

/** Elige el modelo: el indicado, o el primer Qwen instalado, o el primero que haya. */
export async function resolveModel(endpoint: string, wanted: string): Promise<string> {
  const names = await tags(endpoint);
  if (names.length === 0) throw new AiError("Ollama no tiene ningún modelo instalado todavía.");
  if (wanted) {
    const hit = names.find((n) => n === wanted || n.startsWith(`${wanted}:`));
    if (!hit)
      throw new AiError(`El modelo «${wanted}» no está instalado. Instalados: ${names.join(", ")}`);
    return hit;
  }
  return names.find((n) => /qwen/i.test(n)) ?? names[0]!;
}

export async function testAi(endpoint: string, wanted: string) {
  const model = await resolveModel(endpoint, wanted);
  return model;
}

export async function chat(
  history: AiMsg[],
  o: { endpoint: string; model: string; signal: AbortSignal; onToken: (full: string) => void },
): Promise<string> {
  const model = await resolveModel(o.endpoint, o.model);
  let res: Response;
  try {
    res = await fetchLocal(`${o.endpoint}/api/chat`, {
      method: "POST",
      signal: o.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        think: false,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new AiUnreachable(connectionHint(o.endpoint, e));
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new AiError(`Ollama respondió ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (j.error) throw new AiError(j.error);
      const c = j.message?.content;
      if (c) {
        acc += c;
        o.onToken(clean(acc));
      }
    }
  }
  return clean(acc);
}

/** Respuesta simulada (mientras Qwen no esté conectado), emitida palabra a palabra. */
export async function simulate(
  text: string,
  signal: AbortSignal,
  onToken: (full: string) => void,
): Promise<string> {
  const m = text.toLowerCase();
  let out: string;
  if (/\b(hola|hey|buenas|qué tal)\b/.test(m))
    out =
      "Hola. Estoy aquí, en el lado 2.0. Por ahora respondo en modo simulado, hasta que conectes a Qwen en tu computador.";
  else if (/(quién|quien) eres|qué eres/.test(m))
    out =
      "Soy Juspross 2.0. Cuando conectes a Qwen desde tu computador, él pensará detrás de este núcleo. Ahora mismo respondo con texto simulado.";
  else
    out = `Recibí: «${text.length > 120 ? text.slice(0, 120) + "…" : text}». Esta respuesta es simulada: en cuanto conectes a Qwen, ahí responderá la IA de verdad.`;
  const words = out.split(" ");
  let acc = "";
  for (const w of words) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    acc += (acc ? " " : "") + w;
    onToken(acc);
    await new Promise((r) => setTimeout(r, 38));
  }
  return out;
}
