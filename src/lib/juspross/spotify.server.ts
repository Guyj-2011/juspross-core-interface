const TOKEN_COOKIE = "jp_spotify_session";
const OAUTH_COOKIE = "jp_spotify_oauth";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

export interface SpotifySessionRead {
  session: SpotifyTokens | null;
  setCookie?: string | undefined;
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function spotifyConfig() {
  return {
    clientId: env("SPOTIFY_CLIENT_ID"),
    redirectUri: env("SPOTIFY_REDIRECT_URI"),
    encryptionKey: env("SPOTIFY_TOKEN_ENCRYPTION_KEY"),
  };
}

export function spotifyConfigured(): boolean {
  const c = spotifyConfig();
  return Boolean(c.clientId && c.redirectUri && c.encryptionKey.length >= 32);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const secret = spotifyConfig().encryptionKey;
  if (secret.length < 32) throw new Error("Falta SPOTIFY_TOKEN_ENCRYPTION_KEY (mínimo 32 caracteres).");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealSpotifyValue(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    encoder.encode(JSON.stringify(value)),
  );
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function unsealSpotifyValue<T>(value: string): Promise<T | null> {
  try {
    const [ivPart, encryptedPart] = value.split(".");
    if (!ivPart || !encryptedPart) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(ivPart) },
      await encryptionKey(),
      fromBase64Url(encryptedPart),
    );
    return JSON.parse(decoder.decode(decrypted)) as T;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const item of header.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return null;
}

function cookie(name: string, value: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function spotifySessionCookie(tokens: SpotifyTokens, request: Request): Promise<string> {
  return sealSpotifyValue(tokens).then((value) => cookie(TOKEN_COOKIE, value, request, 60 * 60 * 24 * 180));
}

export function clearSpotifySessionCookie(request: Request): string {
  return cookie(TOKEN_COOKIE, "", request, 0);
}

export function clearSpotifyOAuthCookie(request: Request): string {
  return cookie(OAUTH_COOKIE, "", request, 0);
}

export async function spotifyOAuthCookie(value: unknown, request: Request): Promise<string> {
  const sealed = await sealSpotifyValue(value);
  return cookie(OAUTH_COOKIE, sealed, request, 600);
}

export async function readSpotifyOAuthCookie<T>(request: Request): Promise<T | null> {
  const value = readCookie(request, OAUTH_COOKIE);
  return value ? unsealSpotifyValue<T>(value) : null;
}

export async function readSpotifySession(request: Request, forceRefresh = false): Promise<SpotifySessionRead> {
  const sealed = readCookie(request, TOKEN_COOKIE);
  if (!sealed) return { session: null };
  const tokens = await unsealSpotifyValue<SpotifyTokens>(sealed);
  if (!tokens?.refresh_token || !tokens.access_token) return { session: null, setCookie: clearSpotifySessionCookie(request) };
  if (!forceRefresh && tokens.expires_at > Date.now() + 60_000) return { session: tokens };

  const { clientId } = spotifyConfig();
  if (!clientId) return { session: null, setCookie: clearSpotifySessionCookie(request) };
  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }),
    });
    const payload = await response.json().catch(() => ({})) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!response.ok || !payload.access_token || !payload.expires_in) {
      return { session: null, setCookie: clearSpotifySessionCookie(request) };
    }
    const refreshed: SpotifyTokens = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + payload.expires_in * 1000,
      scope: payload.scope ?? tokens.scope,
    };
    return { session: refreshed, setCookie: await spotifySessionCookie(refreshed, request) };
  } catch {
    return { session: null, setCookie: clearSpotifySessionCookie(request) };
  }
}

export async function spotifyApi(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; setCookie?: string | undefined; accessToken: string; scope: string }> {
  let read = await readSpotifySession(request);
  if (!read.session) throw new Error("Spotify no está conectado. Conecta tu cuenta desde Ajustes.");
  const send = (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("Content-Type", "application/json");
    return fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000),
      headers,
    });
  };
  let response = await send(read.session.access_token);
  if (response.status === 401) {
    read = await readSpotifySession(request, true);
    if (!read.session) throw new Error("La conexión de Spotify caducó. Vuelve a conectarla desde Ajustes.");
    response = await send(read.session.access_token);
  }
  return { response, setCookie: read.setCookie, accessToken: read.session.access_token, scope: read.session.scope ?? "" };
}
