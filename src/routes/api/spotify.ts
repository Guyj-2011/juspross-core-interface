import { createFileRoute } from "@tanstack/react-router";
import {
  clearSpotifySessionCookie,
  readSpotifySession,
  spotifyConfigured,
} from "@/lib/juspross/spotify.server";

export const Route = createFileRoute("/api/spotify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let read;
        try { read = await readSpotifySession(request); }
        catch (error) {
          return Response.json({ configured: spotifyConfigured(), connected: true, temporarilyUnavailable: true, message: error instanceof Error ? error.message : "Spotify no está disponible temporalmente." }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        return Response.json(
          { configured: spotifyConfigured(), connected: Boolean(read.session) },
          {
            headers: {
              "Cache-Control": "no-store",
              ...(read.setCookie ? { "Set-Cookie": read.setCookie } : {}),
            },
          },
        );
      },
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
          return Response.json({ message: "Solicitud no autorizada." }, { status: 403 });
        return Response.json(
          { ok: true, connected: false },
          {
            headers: {
              "Cache-Control": "no-store",
              "Set-Cookie": clearSpotifySessionCookie(request),
            },
          },
        );
      },
    },
  },
});
