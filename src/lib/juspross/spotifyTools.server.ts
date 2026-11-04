import { spotifyApi } from "@/lib/juspross/spotify.server";

export const SPOTIFY_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "spotify_search_and_play",
      description: "Busca en Spotify y reproduce el primer resultado relevante. Usa kind=playlist cuando el usuario pida una playlist/lista; usa kind=track para canciones o artistas. El servidor mantiene los resultados de Spotify fuera del modelo y solo devuelve si la acción funcionó.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nombre de canción, artista o playlist solicitado por el usuario." },
          kind: { type: "string", enum: ["track", "playlist"], description: "Tipo de resultado que se debe reproducir." }
        },
        required: ["query", "kind"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "spotify_resume",
      description: "Reanuda la reproducción actual de Spotify en el dispositivo activo.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "spotify_pause",
      description: "Pausa la reproducción actual de Spotify.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "spotify_next",
      description: "Avanza a la siguiente canción en Spotify.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "spotify_previous",
      description: "Vuelve a la canción anterior en Spotify.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "spotify_playback_status",
      description: "Comprueba únicamente si Spotify está reproduciendo o pausado. No devuelve nombres, artistas, playlists ni otros datos del catálogo.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  }
] as const;

type ToolResult = { ok: boolean; message: string; setCookie?: string };

async function spotifyRequest(
  request: Request,
  path: string,
  method: string,
  body?: unknown,
): Promise<{ response: Response; setCookie?: string }> {
  return spotifyApi(request, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function playbackAction(
  request: Request,
  path: string,
  method: string,
  body?: unknown,
  success = "Acción completada en Spotify.",
): Promise<ToolResult> {
  const { response, setCookie } = await spotifyRequest(request, path, method, body);
  if (response.ok || response.status === 204) return { ok: true, message: success, setCookie };
  if (response.status === 404)
    return { ok: false, message: "No hay un dispositivo Spotify activo. Abre Spotify en un dispositivo y vuelve a intentarlo.", setCookie };
  if (response.status === 403)
    return { ok: false, message: "Spotify rechazó el control de reproducción. Comprueba que la cuenta y el acceso de la aplicación cumplen los requisitos de Spotify.", setCookie };
  if (response.status === 401)
    return { ok: false, message: "La autorización de Spotify ya no es válida. Vuelve a conectar la cuenta.", setCookie };
  if (response.status === 429)
    return { ok: false, message: "Spotify está limitando temporalmente las solicitudes. Inténtalo de nuevo en un momento.", setCookie };
  return { ok: false, message: `Spotify no pudo completar la acción (HTTP ${response.status}).`, setCookie };
}

export async function executeSpotifyTool(
  request: Request,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "spotify_search_and_play": {
        const query = typeof args.query === "string" ? args.query.trim().slice(0, 160) : "";
        const kind = args.kind === "playlist" ? "playlist" : args.kind === "track" ? "track" : "";
        if (!query || !kind) return { ok: false, message: "Falta una búsqueda válida y su tipo (canción o playlist)." };
        const search = await spotifyRequest(
          request,
          `/search?${new URLSearchParams({ q: query, type: kind, limit: "1" }).toString()}`,
          "GET",
        );
        if (!search.response.ok) {
          return { ok: false, message: `Spotify no pudo realizar la búsqueda (HTTP ${search.response.status}).`, setCookie: search.setCookie };
        }
        const payload = await search.response.json().catch(() => ({})) as {
          tracks?: { items?: { uri?: string }[] };
          playlists?: { items?: { uri?: string }[] };
        };
        const uri = kind === "track" ? payload.tracks?.items?.[0]?.uri : payload.playlists?.items?.[0]?.uri;
        if (!uri) return { ok: false, message: "No se encontró un resultado reproducible en Spotify.", setCookie: search.setCookie };
        const played = await spotifyRequest(
          request,
          "/me/player/play",
          "PUT",
          uri.startsWith("spotify:track:") ? { uris: [uri] } : { context_uri: uri },
        );
        if (played.response.ok || played.response.status === 204)
          return { ok: true, message: "Spotify inició la reproducción correctamente.", setCookie: played.setCookie ?? search.setCookie };
        if (played.response.status === 404)
          return { ok: false, message: "No hay un dispositivo Spotify activo. Abre Spotify y vuelve a intentarlo.", setCookie: played.setCookie ?? search.setCookie };
        return { ok: false, message: `Spotify encontró contenido, pero no pudo iniciar la reproducción (HTTP ${played.response.status}).`, setCookie: played.setCookie ?? search.setCookie };
      }
      case "spotify_resume":
        return playbackAction(request, "/me/player/play", "PUT", undefined, "Spotify reanudó la reproducción.");
      case "spotify_pause":
        return playbackAction(request, "/me/player/pause", "PUT", undefined, "Spotify pausó la reproducción.");
      case "spotify_next":
        return playbackAction(request, "/me/player/next", "POST", undefined, "Spotify pasó a la siguiente canción.");
      case "spotify_previous":
        return playbackAction(request, "/me/player/previous", "POST", undefined, "Spotify volvió a la canción anterior.");
      case "spotify_playback_status": {
        const { response, setCookie } = await spotifyRequest(request, "/me/player", "GET");
        if (response.status === 204) return { ok: true, message: "Spotify no tiene reproducción activa en este momento.", setCookie };
        if (!response.ok) return { ok: false, message: `No se pudo consultar el estado de Spotify (HTTP ${response.status}).`, setCookie };
        const payload = await response.json().catch(() => ({})) as { is_playing?: boolean };
        return {
          ok: true,
          message: payload.is_playing ? "Spotify está reproduciendo." : "Spotify está pausado.",
          setCookie,
        };
      }
      default:
        return { ok: false, message: "Nemotron solicitó una herramienta de Spotify no reconocida." };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo conectar con Spotify.",
    };
  }
}
