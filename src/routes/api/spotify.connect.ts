import { createFileRoute } from "@tanstack/react-router";
import { spotifyConfig, spotifyOAuthCookie, spotifyConfigured } from "@/lib/juspross/spotify.server";

function randomBase64Url(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export const Route = createFileRoute("/api/spotify/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
          return Response.json({ message: "Solicitud no autorizada." }, { status: 403 });
        if (!spotifyConfigured())
          return Response.json({ message: "Faltan SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI o SPOTIFY_TOKEN_ENCRYPTION_KEY." }, { status: 503 });

        const { clientId, redirectUri } = spotifyConfig();
        const state = randomBase64Url(24);
        const verifier = randomBase64Url(64);
        const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
        let binary = "";
        for (const byte of new Uint8Array(challengeBytes)) binary += String.fromCharCode(byte);
        const challenge = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        const stateCookie = await spotifyOAuthCookie({ state, verifier }, request);
        const params = new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          redirect_uri: redirectUri,
          scope: "user-read-playback-state user-modify-playback-state",
          state,
          code_challenge_method: "S256",
          code_challenge: challenge,
        });
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://accounts.spotify.com/authorize?${params.toString()}`,
            "Set-Cookie": stateCookie,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
