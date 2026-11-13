import { spotifyApi } from "@/lib/juspross/spotify.server";

export const SPOTIFY_TOOL_DEFINITIONS = [
  { type: "function", function: { name: "spotify_play_personalized", description: "Reproduce una canción de los gustos reales del usuario. Si different_artist=true, elige una canción de un artista distinto al que está sonando.", parameters: { type: "object", properties: { different_artist: { type: "boolean" } }, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_volume", description: "Ajusta el volumen de Spotify. Usa target para fijar un porcentaje exacto de 0 a 100; usa direction=up o direction=down solo para cambiarlo en 10 puntos.", parameters: { type: "object", properties: { target: { type: "integer", minimum: 0, maximum: 100 }, direction: { type: "string", enum: ["up", "down"] } }, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_search_and_play", description: "Busca la canción o playlist que el usuario pidió explícitamente. Para canciones, respeta exactamente el título y el artista indicados; no sustituyas por una canción parecida, la que ya suena ni un resultado de conversaciones anteriores. Si no hay coincidencia clara, informa que no la encontraste en vez de reproducir otra.", parameters: { type: "object", properties: { query: { type: "string", description: "Nombre de canción, artista o playlist." }, kind: { type: "string", enum: ["track", "playlist"] } }, required: ["query", "kind"], additionalProperties: false } } },
  { type: "function", function: { name: "spotify_resume", description: "Reanuda la reproducción de Spotify en el dispositivo disponible.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_pause", description: "Pausa la reproducción actual de Spotify.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_next", description: "Avanza a la siguiente canción.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_previous", description: "Vuelve a la canción anterior.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "spotify_playback_status", description: "Comprueba si Spotify está reproduciendo o pausado, sin devolver datos del catálogo.", parameters: { type: "object", properties: {}, additionalProperties: false } } }
] as const;

type ToolResult = { ok: boolean; message: string; setCookie?: string | undefined };
type SpotifyDevice = { id?: string | null; is_active?: boolean; is_restricted?: boolean; type?: string; volume_percent?: number | null };

async function spotifyRequest(request: Request, path: string, method: string, body?: unknown) {
  return spotifyApi(request, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function choosePlaybackDevice(accessToken: string): Promise<{ deviceId: string | null; volumePercent: number | null; response: Response }> {
  const response = await fetch("https://api.spotify.com/v1/me/player/devices", {
    method: "GET", signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { deviceId: null, volumePercent: null, response };
  const payload = await response.json().catch(() => ({})) as { devices?: SpotifyDevice[] };
  const devices = (payload.devices ?? []).filter(
    (device): device is SpotifyDevice & { id: string } => Boolean(device.id) && !device.is_restricted,
  );
  const selected = devices.find((device) => device.is_active)
    ?? devices.find((device) => device.type === "computer")
    ?? devices[0];
  return { deviceId: selected?.id ?? null, volumePercent: typeof selected?.volume_percent === "number" ? selected.volume_percent : null, response };
}

function playbackError(status: number): string {
  if (status === 401) return "La autorización de Spotify caducó. Vuelve a conectar la cuenta desde Ajustes.";
  if (status === 403) return "Spotify rechazó el control mediante la API. Puede deberse a restricciones de la cuenta, del dispositivo o del servicio; no significa necesariamente que la cuenta esté desconectada.";
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
          ok: true,
          message: expectedPlaying
            ? "Spotify aceptó la orden de reanudar, pero el estado todavía no se actualiza. No repetiré la orden para evitar ejecuciones duplicadas."
            : "Spotify aceptó la orden de pausa, pero el estado todavía no se actualiza. No repetiré la orden.",
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
          if (top.response.status === 403) return { ok: false, message: top.scope.split(/\s+/).includes("user-top-read") ? "Spotify mantiene tu cuenta conectada, pero ha rechazado la consulta de tus canciones más escuchadas. Puedes pedirme un artista o una canción concreta; no hace falta desconectar la cuenta." : "Tu cuenta de Spotify sigue conectada, pero la autorización actual no incluye el permiso para consultar tus canciones más escuchadas. Vuelve a conectar Spotify desde Ajustes y acepta el permiso adicional.", setCookie: top.setCookie };
          return { ok: false, message: `No pude consultar tus gustos musicales en Spotify (HTTP ${top.response.status}).`, setCookie: top.setCookie };
        }
        const data = await top.response.json().catch(() => ({})) as { items?: { name?: string; artists?: { name?: string }[] }[] };
        const favorites = (data.items ?? []).filter((item) => item.name && item.artists?.[0]?.name);
        if (!favorites.length) return { ok: false, message: "Todavía no tengo suficientes datos de tus canciones más escuchadas. Pídeme un artista o una canción concreta, o escucha música un tiempo y vuelve a intentarlo.", setCookie: top.setCookie };
        let candidates = favorites;
        if (args["different_artist"] === true) {
          const current = await spotifyRequest(request, "/me/player", "GET");
          if (current.response.ok) {
            const playing = await current.response.json().catch(() => ({})) as { item?: { artists?: { name?: string }[] } };
            const currentArtist = (playing.item?.artists?.[0]?.name ?? "").toLocaleLowerCase("es");
            if (currentArtist) {
              const alternatives = favorites.filter((item) => (item.artists?.[0]?.name ?? "").toLocaleLowerCase("es") !== currentArtist);
              if (alternatives.length) candidates = alternatives;
            }
          }
        }
        const pool = candidates.slice(0, 10);
        const chosen = pool[Math.floor(Math.random() * pool.length)]!;
        const artist = chosen.artists![0]!.name!;
        const played = await executeSpotifyTool(request, "spotify_search_and_play", { query: `track:${chosen.name} artist:${artist}`, kind: "track" });
        return { ...played, message: played.ok ? `Elegí una canción de tus favoritas: ${chosen.name} de ${artist}. ${played.message}` : played.message, setCookie: played.setCookie ?? top.setCookie };
      }
      case "spotify_volume": {
        const target = typeof args["target"] === "number" && Number.isInteger(args["target"])
          ? Math.max(0, Math.min(100, args["target"]))
          : null;
        const direction = args["direction"] === "up" || args["direction"] === "down" ? args["direction"] : null;
        if (target === null && !direction) return { ok: false, message: "Indica un porcentaje exacto o si quieres subir o bajar el volumen." };
        const current = await spotifyRequest(request, "/me/player/devices", "GET");
        if (!current.response.ok) return { ok: false, message: playbackError(current.response.status), setCookie: current.setCookie };
        const { deviceId, volumePercent, response: devicesResponse } = await choosePlaybackDevice(current.accessToken);
        if (!devicesResponse.ok) return { ok: false, message: playbackError(devicesResponse.status), setCookie: current.setCookie };
        if (!deviceId) return { ok: false, message: "No detecté un dispositivo Spotify disponible. Abre Spotify en tu PC y vuelve a intentarlo.", setCookie: current.setCookie };
        if (volumePercent === null) return { ok: false, message: "Spotify no informó el volumen del dispositivo actual; no puedo calcular ni verificar el cambio.", setCookie: current.setCookie };
        const nextVolume = target !== null ? target : Math.max(0, Math.min(100, volumePercent + (direction === "up" ? 10 : -10)));
        if (nextVolume === volumePercent) return { ok: true, message: `El volumen ya está en ${nextVolume}%.`, setCookie: current.setCookie };
        const changed = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${nextVolume}&device_id=${encodeURIComponent(deviceId)}`, {
          method: "PUT", signal: AbortSignal.timeout(12_000),
          headers: { Authorization: `Bearer ${current.accessToken}` },
        });
        if (!changed.ok && changed.status !== 204) return { ok: false, message: playbackError(changed.status), setCookie: current.setCookie };
        let confirmed = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const verify = await choosePlaybackDevice(current.accessToken);
          if (verify.response.ok && verify.deviceId === deviceId && verify.volumePercent === nextVolume) {
            confirmed = true;
            break;
          }
          if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (!confirmed) return { ok: true, message: `Spotify aceptó el volumen de ${nextVolume}%, pero todavía no actualiza el valor de confirmación. No repetiré el cambio.`, setCookie: current.setCookie };
        return { ok: true, message: `Volumen de Spotify establecido en ${nextVolume}%.`, setCookie: current.setCookie };
      }
      case "spotify_search_and_play": {
        const query = typeof args["query"] === "string" ? args["query"].trim().slice(0, 160) : "";
        const kind = args["kind"] === "playlist" ? "playlist" : args["kind"] === "track" ? "track" : "";
        if (!query || !kind) return { ok: false, message: "Falta una búsqueda válida y su tipo (canción o playlist)." };
        const trackQuery = query.match(/^track:(.*?)\s+artist:(.+)$/i);
        const artistQuery = query.match(/^artist:(.+)$/i);
        const requestedTitle = trackQuery?.[1]?.trim() ?? (artistQuery ? "" : query.replace(/^track:/i, "").trim());
        const requestedArtist = trackQuery?.[2]?.trim() ?? artistQuery?.[1]?.trim() ?? "";
        // Spotify interpreta peor los operadores de búsqueda con ciertos signos (AC/DC).
        // Buscamos con texto normal y validamos título/artista sobre los resultados.
        const searchTerm = artistQuery ? requestedArtist : [requestedTitle, requestedArtist].filter(Boolean).join(" ");
        const search = await spotifyRequest(request, `/search?${new URLSearchParams({ q: searchTerm, type: kind, limit: "20" }).toString()}`, "GET");
        if (!search.response.ok) return { ok: false, message: `Spotify no pudo realizar la búsqueda (HTTP ${search.response.status}).`, setCookie: search.setCookie };
        const payload = await search.response.json().catch(() => ({})) as {
          tracks?: { items?: { name?: string; uri?: string; popularity?: number; artists?: { name?: string }[]; album?: { uri?: string } }[] };
          playlists?: { items?: { uri?: string }[] };
        };
        const normalize = (value: string) => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        const normalizeArtist = (value: string) => normalize(value).replace(/\\s/g, "");
        const wantedTitle = normalize(requestedTitle);
        const wantedArtist = normalizeArtist(requestedArtist);
        const tracks = payload.tracks?.items ?? [];
        const ranked = tracks.map((item) => {
          const title = normalize(item.name ?? "");
          const artists = (item.artists ?? []).map((artist) => normalizeArtist(artist.name ?? ""));
          const titleExact = Boolean(wantedTitle) && title === wantedTitle;
          // Permite títulos oficiales con subtítulos entre paréntesis, como Waka Waka (This Time for Africa).
          const titleMatch = Boolean(wantedTitle) && (titleExact || title.startsWith(`${wantedTitle} (`) || title.startsWith(`${wantedTitle} -`));
          const artistExact = !wantedArtist || artists.some((artist) => artist === wantedArtist);
          const artistClose = !wantedArtist || artists.some((artist) => artist.includes(wantedArtist) || wantedArtist.includes(artist));
          const score = (titleExact ? 110 : titleMatch ? 90 : 0) + (artistExact && wantedArtist ? 100 : artistClose && wantedArtist ? 35 : 0) + (item.popularity ?? 0) / 100;
          return { item, score, titleExact, titleMatch, artistExact, artistClose };
        }).sort((a, b) => b.score - a.score);
        const best = ranked.find((candidate) => {
          if (artistQuery) return candidate.artistExact || candidate.artistClose;
          if (!candidate.titleMatch) return false;
          return !wantedArtist || candidate.artistExact || candidate.artistClose;
        });
        const track = kind === "track" ? best?.item : undefined;
        const uri = kind === "track" ? track?.uri : payload.playlists?.items?.[0]?.uri;
        const albumUri = track?.album?.uri;
        if (!uri) {
          const label = requestedTitle || requestedArtist || query;
          return { ok: false, message: kind === "track" ? `No encontré una canción que coincida con “${label}”${requestedArtist ? ` de ${requestedArtist}` : ""}. No he reproducido otra canción.` : "No se encontró una playlist reproducible en Spotify.", setCookie: search.setCookie };
        }
        const { deviceId, response: devicesResponse } = await choosePlaybackDevice(search.accessToken);
        if (!devicesResponse.ok) return { ok: false, message: playbackError(devicesResponse.status), setCookie: search.setCookie };
        if (!deviceId) return { ok: false, message: "Encontré el contenido, pero no detecté un dispositivo Spotify disponible. Abre Spotify en tu PC y vuelve a intentarlo.", setCookie: search.setCookie };
        const playedResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
          method: "PUT", signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${search.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(kind === "track" && albumUri
            ? { context_uri: albumUri, offset: { uri } }
            : kind === "track"
              ? { uris: [uri] }
              : { context_uri: uri }),
        });
        if (playedResponse.ok || playedResponse.status === 204) {
          const confirmed = await waitForPlaybackState(search.accessToken, true, kind === "track" ? uri : undefined, kind === "playlist" ? uri : undefined);
          const playedLabel = artistQuery
            ? `Spotify está reproduciendo “${track?.name ?? "una canción"}” de ${(track?.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", ") || requestedArtist}.`
            : requestedArtist
              ? `Spotify está reproduciendo “${track?.name ?? requestedTitle}” de ${(track?.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", ")}.`
              : `Spotify está reproduciendo “${track?.name ?? requestedTitle}”.`;
          return { ok: true, message: confirmed ? playedLabel : `${playedLabel} Spotify aceptó la orden; el estado del reproductor todavía no se actualiza. No repetiré la orden.`, setCookie: search.setCookie };
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
