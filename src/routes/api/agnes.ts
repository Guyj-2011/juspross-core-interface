import { createFileRoute } from "@tanstack/react-router";
import { AGNES_BASE, buildUpstream } from "@/lib/juspross/agnesRequest";

/**
 * Ruta de respaldo hacia la API de Agnes (https://apihub.agnes-ai.com).
 *  - La clave la manda el navegador en cada petición; aquí no se guarda ni se registra.
 *  - Aplica las mismas barreras que el navegador (solo modelos gratuitos y tamaños moderados),
 *    así que aunque alguien manipule el cliente no se puede llamar a otro modelo.
 *  - Ojo: las llamadas salen desde direcciones compartidas del servidor, que Cloudflare (que protege a
 *    Agnes) puede limitar (error 1015). Por eso el navegador intenta primero la ruta directa.
 */
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
    const headers: Record<string, string> = {
      "Content-Type": up.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    };
    const retryAfter = up.headers.get("retry-after");
    if (retryAfter) headers["Retry-After"] = retryAfter;
    return new Response(text, { status: up.status, headers });
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

        // descarga de resultados (imágenes/videos) desde los servidores de Agnes, sin CORS
        if (input["op"] === "download") {
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
        const built = buildUpstream(input);
        if (!built.ok) return bad(built.message, built.status);
        const { method, path, body } = built.up;
        return forward(
          `${AGNES_BASE}${path}`,
          {
            method,
            headers: {
              Authorization: `Bearer ${key}`,
              ...(body ? { "Content-Type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
          request.signal,
        );
      },
    },
  },
});
