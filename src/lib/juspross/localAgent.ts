/** Cliente del agente local (solo navegador). El token nunca se envía al modelo ni al servidor. */
export const LOCAL_AGENT_URL = "http://127.0.0.1:47821";
const TOKEN_KEY = "juspross.localAgent.token";

export type LocalReason =
  | "launch_requested"
  | "not_running"
  | "not_paired"
  | "blocked_by_browser"
  | "not_installed"
  | "bad_code"
  | "code_expired"
  | "pairing_locked"
  | "rate_limited"
  | "error";
export type LocalResult = { ok: boolean; reason: LocalReason };

const getToken = () => (typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY));

async function lnaDenied(): Promise<boolean> {
  try {
    const st = await navigator.permissions.query({ name: "local-network-access" as PermissionName });
    return st.state === "denied";
  } catch {
    try {
      const st = await navigator.permissions.query({ name: "loopback-network" as PermissionName });
      return st.state === "denied";
    } catch {
      return false;
    }
  }
}

async function call(path: string, init: RequestInit = {}, auth = true): Promise<{ status: number; body: Record<string, unknown> } | LocalResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = auth ? getToken() : null;
  if (auth) {
    if (!token) return { ok: false, reason: "not_paired" };
    headers["Authorization"] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(LOCAL_AGENT_URL + path, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(4000),
      // Chrome Local Network Access: declara el destino loopback.
      targetAddressSpace: "loopback",
    } as RequestInit);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  } catch {
    return { ok: false, reason: (await lnaDenied()) ? "blocked_by_browser" : "not_running" };
  }
}

const isResult = (v: unknown): v is LocalResult => typeof v === "object" && v !== null && "reason" in v && !("status" in v);

export async function localAgentStatus(): Promise<{ running: boolean; paired: boolean; reason?: LocalReason }> {
  const token = getToken();
  const r = await call("/v1/health", { method: "GET" }, Boolean(token));
  if (isResult(r)) {
    if (r.reason === "not_paired") {
      const anon = await call("/v1/health", { method: "GET" }, false);
      return isResult(anon) ? { running: false, paired: false, reason: anon.reason } : { running: true, paired: false };
    }
    return { running: false, paired: false, reason: r.reason };
  }
  return { running: r.status === 200, paired: Boolean(r.body["authorized"]) };
}

export async function pairLocalAgent(code: string): Promise<LocalResult> {
  const r = await call("/v1/pair", { method: "POST", body: JSON.stringify({ code: code.trim() }) }, false);
  if (isResult(r)) return r;
  const token = r.body["token"];
  if (r.status === 200 && typeof token === "string") {
    window.localStorage.setItem(TOKEN_KEY, token);
    return { ok: true, reason: "launch_requested" };
  }
  return { ok: false, reason: (r.body["reason"] as LocalReason) ?? "error" };
}

export async function unpairLocalAgent(): Promise<void> {
  await call("/v1/unpair", { method: "POST", body: "{}" }).catch(() => undefined);
  window.localStorage.removeItem(TOKEN_KEY);
}

export async function openSpotifyDesktop(): Promise<LocalResult> {
  const r = await call("/v1/tools/open_spotify", { method: "POST", body: "{}" });
  if (isResult(r)) return r;
  if (r.status === 401) {
    window.localStorage.removeItem(TOKEN_KEY);
    return { ok: false, reason: "not_paired" };
  }
  if (r.status === 429) return { ok: false, reason: "rate_limited" };
  const reason = r.body["reason"];
  if (r.body["ok"] === true && reason === "launch_requested") return { ok: true, reason };
  return { ok: false, reason: reason === "not_installed" ? "not_installed" : "error" };
}

export function describeLocalResult(r: LocalResult): string {
  if (r.ok) return "El agente local pidió a Windows abrir Spotify en tu PC.";
  switch (r.reason) {
    case "not_running":
      return "No pude abrir Spotify: el agente local de Juspross no está en ejecución en tu PC (o el navegador no deja contactarlo). Ejecútalo y vuelve a intentarlo.";
    case "not_paired":
      return "No pude abrir Spotify: este navegador no está emparejado con el agente local. Empareja el equipo en Configuración → Equipo local.";
    case "blocked_by_browser":
      return "No pude abrir Spotify: el navegador bloqueó el acceso a la red local. Permite «acceso a la red local» para este sitio en los ajustes del navegador.";
    case "not_installed":
      return "No pude abrir Spotify: el agente local no encontró Spotify instalado en Windows.";
    case "rate_limited":
      return "No pude abrir Spotify: demasiadas solicitudes al agente local. Espera un minuto.";
    default:
      return "No pude abrir Spotify: el agente local devolvió un error.";
  }
}
