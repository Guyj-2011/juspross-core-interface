import { spotifyApi } from "@/lib/juspross/spotify.server";

export const SPOTIFY_TOOL_DEFINITIONS = [
  { type: "function", function: { name: "spotify_play_personalized", description: "Reproduce una canción que encaje con los gustos reales del usuario, usando sus canciones más escuchadas de Spotify. Úsala cuando diga simplemente pon una canción, pon música o elige algo que me guste sin nombrar artista ni título.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_volume", description: "Sube o baja el volumen del dispositivo Spotify actual en pasos de 10 puntos porcentuales. Usa direction=up o direction=down.", parameters: { type: "object", properties: { direction: { type: "string", enum: ["up", "down"] } }, required: ["direction"], additionalProperties: false } } },
  { type: "function", function: { name: "spotify_search_and_play", description: "Busca la canción o playlist que el usuario pidió explícitamente. Para canciones, respeta exactamente el título y el artista indicados; no sustituyas por una canción parecida, la que ya suena ni un resultado de conversaciones anteriores. Si no hay coincidencia clara, informa que no la encontraste en vez de reproducir otra.", parameters: { type: "object", properties: { query: { type: "string", description: "Nombre de canción, artista o playlist." }, kind: { type: "string", enum: ["track", "playlist"] } }, required: ["query", "kind"], additionalProperties: false } } },
  { type: "function", function: { name: "spotify_resume", description: "Reanuda la reproducción de Spotify en el dispositivo disponible.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_pause", description: "Pausa la reproducción actual de Spotify.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_next", description: "Avanza a la siguiente canción.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_previous", description: "Vuelve a la canción anterior.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_playback_status", description: "Comprueba si Spotify está reproduciendo o pausado, sin devolver datos del catálogo.", parameters: { type: "object", properties: {}, additionalProperties: false } } }
] as const;

type ToolResult = { ok: boolean; message: string; setCookie?: string | undefined };
type SpotifyDevice = { id?: string | null; is_active?: boolean; is_restricted?: boolean; type?: string };

async function spotifyRequest(request: Request, path: string, method: string, body?: unknown) {
  return spotifyApi(request, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function choosePlaybackDevice(accessToken: string): Promise<{ deviceId: string | null; response: Response }> {
  const response = await fetch("https://api.spotify.com/v1/me/player/devices", {
    method: "GET", signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { deviceId: null, response };
  const payload = await response.json().catch(() => ({})) as { devices?: SpotifyDevice[] };
  const devices = (payload.devices ?? []).filter(
    (device): device is SpotifyDevice & { id: string } => Boolean(device.id) && !device.is_restricted,
  );
  const selected = devices.find((device) => device.is_active)
    ?? devices.find((device) => device.type === "computer")
    ?? devices[0];
  return { deviceId: selected?.id ?? null, response };
}

function playbackError(status: number): string {
  if (status === 401) return "La autorización de Spotify caducó. Vuelve a conectar la cuenta desde Ajustes.";
  if (status === 403) return "Spotify rechazó el control. La reproducción mediante la API requiere Spotify Premium y un dispositivo compatible.";
  if (status === 404) return "Spotify no encontró un dispositivo de reproducción disponible. Abre la aplicación y espera unos segundos.";
  if (status === 429) return "Spotify está limitando temporalmente las solicitudes. Inténtalo de nuevo en un momento.";
  return `Spotify no pudo completar la acción (HTTP ${status}).`;
}

/** Spotify puede responder 204 al aceptar una orden sin que eso confirme el estado real del reproductor. */
async function waitForPlaybackState(accessToken: string, expectedPlaying: boolean, expectedTrackUri?: string, expectedContextUri?: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch("https://api.spotify.com/v1/me/player", {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 204) {
      if (!expectedPlaying) return true;
    } else if (response.ok) {
      const payload = await response.json().catch(() => ({})) as {
        is_playing?: boolean;
        item?: { uri?: string | null };
        context?: { uri?: string | null };
      };
      const playingMatches = payload.is_playing === expectedPlaying;
      const trackMatches = !expectedTrackUri || payload.item?.uri === expectedTrackUri;
      const contextMatches = !expectedContextUri || payload.context?.uri === expectedContextUri;
      if (playingMatches && trackMatches && contextMatches) return true;
    }
    if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

async function playbackAction(request: Request, path: string, method: string, body?: unknown, success = "Acción completada en Spotify.", expectedPlaying?: boolean): Promise<ToolResult> {
  const devices = await spotifyRequest(request, "/me/player/devices", "GET");
  if (!devices.response.ok) return { ok: false, message: playbackError(devices.response.status), setCookie: devices.setCookie };
  const { deviceId } = await choosePlaybackDevice(devices.accessToken);
  if (!deviceId) return { ok: false, message: "No detecté ningún dispositivo Spotify disponible. Abre Spotify en tu PC y vuelve a intentarlo.", setCookie: devices.setCookie };
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`https://api.spotify.com/v1${path}${separator}device_id=${encodeURIComponent(deviceId)}`, {
    method, signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${devices.accessToken}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.ok || response.status === 204) {
    if (expectedPlaying !== undefined) {
      const confirmed = await waitForPlaybackState(devices.accessToken, expectedPlaying);
      if (!confirmed) {
        return {
          ok: false,
          message: expectedPlaying
            ? "Spotify aceptó la orden, pero no pude confirmar que la música haya empezado. Comprueba que la aplicación esté abierta y que haya un dispositivo activo."
            : "Spotify aceptó la orden, pero no pude confirmar que la reproducción se haya detenido.",
          setCookie: devices.setCookie,
        };
      }
    }
    return { ok: true, message: success, setCookie: devices.setCookie };
  }
  return { ok: false, message: playbackError(response.status), setCookie: devices.setCookie };
}

export async function executeSpotifyTool(request: Request, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "spotify_play_personalized": {
        const top = await spotifyRequest(request, "/me/top/tracks?time_range=medium_term&limit=20", "GET");
        if (!top.response.ok) {
          if (top.response.status === 403) return { ok: false, message: "Spotify no permite leer tus canciones más escuchadas. Desconecta y vuelve a conectar Spotify para autorizar el permiso de gustos musicales.", setCookie: top.setCookie };
          return { ok: false, message: `No pude consultar tus gustos musicales en Spotify (HTTP ${top.response.status}).`, setCookie: top.setCookie };
        }
        const data = await top.response.json().catch(() => ({})) as { items?: { name?: string; artists?: { name?: string }[] }[] };
        const favorites = (data.items ?? []).filter((item) => item.name && item.artists?.[0]?.name);
        if (!favorites.length) return { ok: false, message: "Todavía no tengo suficientes datos de tus canciones más escuchadas. Pídeme un artista o una canción concreta, o escucha música un tiempo y vuelve a intentarlo.", setCookie: top.setCookie };
        const chosen = favorites[Math.floor(Math.random() * Math.min(favorites.length, 10))]!;
        const artist = chosen.artists![0]!.name!;
        const played = await executeSpotifyTool(request, "spotify_search_and_play", { query: `track:${chosen.name} artist:${artist}`, kind: "track" });
        return { ...played, message: played.ok ? `Elegí una canción de tus favoritas: ${chosen.name} de ${artist}. ${played.message}` : played.message, setCookie: played.setCookie ?? top.setCookie };
      }
      case "spotify_volume": {
        const direction = args["direction"] === "up" ? "up" : args["direction"] === "down" ? "down" : "";
        if (!direction) return { ok: false, message: "Indica si quieres subir o bajar el volumen." };
        const current = await spotifyRequest(request, "/me/player", "GET");
        if (current.response.status === 204) return { ok: false, message: "No hay ningún dispositivo Spotify activo para ajustar el volumen.", setCookie: current.setCookie };
        if (!current.response.ok) return { ok: false, message: playbackError(current.response.status), setCookie: current.setCookie };
        const player = await current.response.json().catch(() => ({})) as { device?: { id?: string; volume_percent?: number | null } };
        const deviceId = player.device?.id;
        const volume = player.device?.volume_percent;
        if (!deviceId || typeof volume !== "number") return { ok: false, message: "Spotify no informó el volumen del dispositivo actual. Puede que el dispositivo no permita ajustarlo desde la API.", setCookie: current.setCookie };
        const nextVolume = Math.max(0, Math.min(100, volume + (direction === "up" ? 10 : -10)));
        if (nextVolume === volume) return { ok: true, message: direction === "up" ? "El volumen ya está al máximo." : "El volumen ya está al mínimo.", setCookie: current.setCookie };
        const changed = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${nextVolume}&device_id=${encodeURIComponent(deviceId)}`, {
          method: "PUT", signal: AbortSignal.timeout(12_000),
          headers: { Authorization: `Bearer ${current.accessToken}` },
        });
        if (!changed.ok && changed.status !== 204) return { ok: false, message: playbackError(changed.status), setCookie: current.setCookie };
        let volumeConfirmed = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const verify = await fetch("https://api.spotify.com/v1/me/player", {
            method: "GET", signal: AbortSignal.timeout(5_000),
            headers: { Authorization: `Bearer ${current.accessToken}` },
          });
          if (verify.ok) {
            const state = await verify.json().catch(() => ({})) as { device?: { id?: string; volume_percent?: number | null } };
            if (state.device?.id === deviceId && state.device.volume_percent === nextVolume) {
              volumeConfirmed = true;
              break;
            }
          }
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
        }
        if (!volumeConfirmed) return { ok: false, message: "Spotify aceptó el cambio, pero no pude confirmar el nuevo volumen del dispositivo.", setCookie: current.setCookie };
        return { ok: true, message: `Volumen de Spotify confirmado en ${nextVolume}%.`, setCookie: current.setCookie };
      }
      case "spotify_search_and_play": {
        const query = typeof args["query"] === "string" ? args["query"].trim().slice(0, 160) : "";
        const kind = args["kind"] === "playlist" ? "playlist" : args["kind"] === "track" ? "track" : "";
        if (!query || !kind) return { ok: false, message: "Falta una búsqueda válida y su tipo (canción o playlist)." };
        const search = await spotifyRequest(request, `/search?${new URLSearchParams({ q: query, type: kind, limit: "10" }).toString()}`, "GET");
        if (!search.response.ok) return { ok: false, message: `Spotify no pudo realizar la búsqueda (HTTP ${search.response.status}).`, setCookie: search.setCookie };
        const payload = await search.response.json().catch(() => ({})) as {
          tracks?: { items?: { name?: string; uri?: string; artists?: { name?: string }[]; album?: { uri?: string } }[] };
          playlists?: { items?: { uri?: string }[] };
        };
        const normalize = (value: string) => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        const trackQuery = query.match(/^track:(.*?)\s+artist:(.+)$/i);
        const artistQuery = query.match(/^artist:(.+)$/i);
        const requestedTitle = trackQuery?.[1]?.trim() ?? (artistQuery ? "" : query.replace(/^track:/i, "").trim());
        const requestedArtist = trackQuery?.[2]?.trim() ?? artistQuery?.[1]?.trim() ?? "";
        const tracks = payload.tracks?.items ?? [];
        const wantedTitle = normalize(requestedTitle);
        const wantedArtist = normalize(requestedArtist);
        const rankedTracks = tracks.map((item) => {
          const title = normalize(item.name ?? "");
          const artists = (item.artists ?? []).map((artist) => normalize(artist.name ?? ""));
          const titleExact = title === wantedTitle;
          const artistExact = !wantedArtist || artists.some((artist) => artist === wantedArtist);
          const titleSimilar = Boolean(wantedTitle && (title.includes(wantedTitle) || wantedTitle.includes(title)));
          const artistSimilar = !wantedArtist || artists.some((artist) => artist.includes(wantedArtist) || wantedArtist.includes(artist));
          const score = (titleExact ? 100 : titleSimilar ? 60 : 0) + (artistExact && wantedArtist ? 60 : artistSimilar && wantedArtist ? 20 : 0);
          return { item, score, titleExact, artistExact };
        }).sort((a, b) => b.score - a.score);
        const bestTrack = rankedTracks[0];
        const track = kind === "track" && bestTrack?.artistExact && (artistQuery ? true : bestTrack.titleExact)
          ? bestTrack.item
          : undefined;
        const uri = kind === "track" ? track?.uri : payload.playlists?.items?.[0]?.uri;
        const albumUri = track?.album?.uri;
        if (!uri) return { ok: false, message: kind === "track" ? `No encontré una coincidencia exacta para “${requestedTitle}”${requestedArtist ? ` de ${requestedArtist}` : ""}. No voy a reproducir otra canción.` : "No se encontró una playlist reproducible en Spotify.", setCookie: search.setCookie };
        const { deviceId, response: devicesResponse } = await choosePlaybackDevice(search.accessToken);
        if (!devicesResponse.ok) return { ok: false, message: playbackError(devicesResponse.status), setCookie: search.setCookie };
        if (!deviceId) return { ok: false, message: "Encontré el contenido, pero no detecté un dispositivo Spotify disponible. Abre Spotify en tu PC y vuelve a intentarlo.", setCookie: search.setCookie };
        const playedResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
          method: "PUT", signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${search.accessToken}`, "Content-Type": "application/json" },
          // Para canciones usamos el álbum como contexto y el URI como offset.
          // Esto evita el fallo reciente en algunos clientes donde /play acepta
          // { uris: [...] } (204) pero no inicia realmente la pista.
          body: JSON.stringify(kind === "track" && albumUri
            ? { context_uri: albumUri, offset: { uri } }
            : kind === "track"
              ? { uris: [uri] }
              : { context_uri: uri }),
        });
        if (playedResponse.ok || playedResponse.status === 204) {
          const confirmed = await waitForPlaybackState(
            search.accessToken,
            true,
            kind === "track" ? uri : undefined,
            kind === "playlist" ? uri : undefined,
          );
          const playedLabel = artistQuery
            ? `Spotify está reproduciendo “${track?.name ?? "una canción"}” de ${(track?.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", ") || requestedArtist}.`
            : "Spotify está reproduciendo la canción solicitada.";
          return confirmed
            ? { ok: true, message: playedLabel, setCookie: search.setCookie }
            : {
                ok: true,
                message: `Spotify aceptó la orden de reproducción de ${artistQuery ? `“${track?.name ?? "la canción elegida"}” de ${requestedArtist}` : `“${requestedTitle}”`}, pero su estado tardó en actualizarse. No repetiré la orden para evitar reiniciar o saltar canciones.`,
                setCookie: search.setCookie,
              };
        }
        return { ok: false, message: playbackError(playedResponse.status), setCookie: search.setCookie };
      }
      case "spotify_resume": return playbackAction(request, "/me/player/play", "PUT", undefined, "Spotify confirmó que la reproducción está activa.", true);
      case "spotify_pause": return playbackAction(request, "/me/player/pause", "PUT", undefined, "Spotify confirmó que la reproducción está pausada.", false);
      case "spotify_next": return playbackAction(request, "/me/player/next", "POST", undefined, "Spotify pasó a la siguiente canción.");
      case "spotify_previous": return playbackAction(request, "/me/player/previous", "POST", undefined, "Spotify volvió a la canción anterior.");
      case "spotify_playback_status": {
        const { response, setCookie } = await spotifyRequest(request, "/me/player", "GET");
        if (response.status === 204) return { ok: true, message: "Spotify no tiene reproducción activa en este momento.", setCookie };
        if (!response.ok) return { ok: false, message: playbackError(response.status), setCookie };
        const payload = await response.json().catch(() => ({})) as { is_playing?: boolean };
        return { ok: true, message: payload.is_playing ? "Spotify está reproduciendo." : "Spotify está pausado.", setCookie };
      }
      default: return { ok: false, message: "Nemotron solicitó una herramienta de Spotify no reconocida." };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo conectar con Spotify." };
  }
}
