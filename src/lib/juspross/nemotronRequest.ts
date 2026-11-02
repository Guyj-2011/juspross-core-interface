/** Validación compartida de peticiones de chat hacia NVIDIA Nemotron (sin secretos). */
export const NEMOTRON_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NEMOTRON_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const NEMOTRON_MAX_TOKENS = 1024;
export const NEMOTRON_MAX_MESSAGES = 40;
export const NEMOTRON_MAX_CHARS = 8000;
export const NEMOTRON_MAX_TOTAL_CHARS = 48000;

export interface NemotronMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export type Validated =
  | { ok: true; messages: NemotronMsg[]; maxTokens: number }
  | { ok: false; message: string };

const ROLES = new Set(["system", "user", "assistant"]);

export function validateNemotronInput(input: unknown): Validated {
  if (!input || typeof input !== "object") return { ok: false, message: "Petición inválida." };
  const { messages, maxTokens } = input as { messages?: unknown; maxTokens?: unknown };
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > NEMOTRON_MAX_MESSAGES)
    return { ok: false, message: `Se necesitan entre 1 y ${NEMOTRON_MAX_MESSAGES} mensajes.` };
  let total = 0;
  const out: NemotronMsg[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return { ok: false, message: "Mensaje inválido." };
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (typeof role !== "string" || !ROLES.has(role)) return { ok: false, message: "Rol de mensaje no permitido." };
    if (typeof content !== "string" || !content.trim() || content.length > NEMOTRON_MAX_CHARS)
      return { ok: false, message: `Cada mensaje debe tener entre 1 y ${NEMOTRON_MAX_CHARS} caracteres.` };
    total += content.length;
    out.push({ role: role as NemotronMsg["role"], content });
  }
  if (total > NEMOTRON_MAX_TOTAL_CHARS) return { ok: false, message: "La conversación es demasiado larga." };
  if (out[out.length - 1]!.role !== "user") return { ok: false, message: "El último mensaje debe ser del usuario." };
  let limit = NEMOTRON_MAX_TOKENS;
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1)
      return { ok: false, message: "Límite de tokens inválido." };
    limit = Math.min(maxTokens, NEMOTRON_MAX_TOKENS);
  }
  return { ok: true, messages: out, maxTokens: limit };
}

/** Extrae solo el contenido final (nunca `reasoning_content`) de un chunk OpenAI. */
export function nemotronDelta(data: string): { content?: string; error?: string; done?: boolean } {
  if (data.trim() === "[DONE]") return { done: true };
  try {
    const j = JSON.parse(data) as {
      choices?: { delta?: { content?: string | null } }[];
      error?: { message?: string } | string;
    };
    if (j.error) return { error: typeof j.error === "string" ? j.error : j.error.message ?? "Error de NVIDIA." };
    const c = j.choices?.[0]?.delta?.content;
    return c ? { content: c } : {};
  } catch {
    return {};
  }
}
