import { createFileRoute } from "@tanstack/react-router";
import {
  clearSpotifyOAuthCookie,
  readSpotifyOAuthCookie,
  spotifyConfig,
  spotifyConfigured,
  spotifySessionCookie,
  type SpotifyTokens,
} from "@/lib/juspross/spotify.server";

function redirect(request: Request, result: string, cookie?: string): Response {
  const headers = new Headers({
    Location: new URL(`/?spotify=${encodeURIComponent(result)}`, request.url).toString(),
    "Cache-Control": "no-store",
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  headers.append("Set-Cookie", clearSpotifyOAuthCookie(request));
  return new Response(null, { status: 302, headers });
}

export const Route = createFileRoute("/api/spotify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!spotifyConfigured()) return redirect(request, "not-configured");
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauth = await readSpotifyOAuthCookie<{ state: string; verifier: string }>(request);
        if (url.searchParams.has("error")) return redirect(request, "denied");
        if (!code || !state || !oauth || state !== oauth.state || !oauth.verifier) {
          return redirect(request, "state-error");
        }

        const { clientId, redirectUri } = spotifyConfig();
        try {
          const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            signal: AbortSignal.timeout(15_000),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
              client_id: clientId,
              code_verifier: oauth.verifier,
            }),
          });
          const payload = await response.json().catch(() => ({})) as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
            scope?: string;
          };
          if (!response.ok || !payload.access_token || !payload.refresh_token || !payload.expires_in) {
            return redirect(request, "token-error");
          }
          const tokens: SpotifyTokens = {
            access_token: payload.access_token,
            refresh_token: payload.refresh_token,
            expires_at: Date.now() + payload.expires_in * 1000,
            scope: payload.scope ?? "",
          };
          return redirect(request, "connected", await spotifySessionCookie(tokens, request));
        } catch {
          return redirect(request, "token-error");
        }
      },
    },
  },
});
