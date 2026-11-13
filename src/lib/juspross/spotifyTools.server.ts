import { spotifyApi, readSpotifySession } from "./spotify.server";
import { SPOTIFY_SEARCH_LIMIT, normalizeMusic, trackMatches, type CommandResult } from "./spotifyCommands";

export const SPOTIFY_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "spotify_play_personalized",
      description:
        "Reproduce una canción de los gustos reales del usuario. Si different_artist=true, elige una canción de un artista distinto al que está sonando.",
      parameters: {
        type: "object",
        properties: { different_artist: { type: "boolean" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify_volume",
      description:
        "Ajusta el volumen de Spotify. Usa target para fijar un porcentaje exacto de 0 a 100; usa direction=up o direction=down solo para cambiarlo en 10 puntos.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "integer", minimum: 0, maximum: 100 },
          direction: { type: "string", enum: ["up", "down"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify_search_and_play",
      description:
        "Busca la canción o playlist que el usuario pidió explícitamente. Para canciones, respeta exactamente el título y el artista indicados; no sustituyas por una canción parecida, la que ya suena ni un resultado de conversaciones anteriores. Si no hay coincidencia clara, informa que no la encontraste en vez de reproducir otra.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nombre de canción, artista o playlist." },
          kind: { type: "string", enum: ["track", "playlist"] },
        },
        required: ["query", "kind"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify_resume",
      description: "Reanuda la reproducción de Spotify en el dispositivo disponible.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify_pause",
      description: "Pausa la reproducción actual de Spotify.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify_next",
      description: "Avanza a la siguiente canción.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify_previous",
      description: "Vuelve a la canción anterior.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify_playback_status",
      description:
        "Comprueba si Spotify está reproduciendo o pausado, sin devolver datos del catálogo.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify_current_artist",
      description: "Devuelve el artista principal de la canción que está sonando.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
] as const;

type ToolResult = CommandResult;
type SpotifyDevice = {
  id?: string | null;
  is_active?: boolean;
  is_restricted?: boolean;
  type?: string;
  volume_percent?: number | null;
};

async function spotifyRequest(request: Request, path: string, method: string, body?: unknown) {
  return spotifyApi(request, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function choosePlaybackDevice(
  accessToken: string,
): Promise<{ deviceId: string | null; volumePercent: number | null; response: Response }> {
  const response = await fetch("https://api.spotify.com/v1/me/player/devices", {
    method: "GET",
    signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { deviceId: null, volumePercent: null, response };
  const payload = (await response.json().catch(() => ({}))) as { devices?: SpotifyDevice[] };
  const devices = (payload.devices ?? []).filter(
    (device): device is SpotifyDevice & { id: string } =>
      Boolean(device.id) && !device.is_restricted,
  );
  const selected =
    devices.find((device) => device.is_active) ??
    devices.find((device) => device.type === "computer") ??
    devices[0];
  return {
    deviceId: selected?.id ?? null,
    volumePercent: typeof selected?.volume_percent === "number" ? selected.volume_percent : null,
    response,
  };
}

export function playbackError(status: number): string {
  if (status === 401)
    return "La autorización de Spotify caducó. Vuelve a conectar la cuenta desde Ajustes.";
  if (status === 403)
    return "Spotify rechazó el control mediante la API. Puede deberse a restricciones de la cuenta, del dispositivo o del servicio; no significa necesariamente que la cuenta esté desconectada.";
  if (status === 404)
    return "Spotify no encontró un dispositivo de reproducción disponible. Abre la aplicación y espera unos segundos.";
  if (status === 429)
    return "Spotify está limitando temporalmente las solicitudes. Inténtalo de nuevo en un momento.";
  return `Spotify no pudo completar la acción (HTTP ${status}).`;
}

/** Spotify puede responder 204 al aceptar una orden sin que eso confirme el estado real del reproductor. */
async function waitForPlaybackState(
  accessToken: string,
  expectedPlaying: boolean,
  expectedTrackUri?: string,
  expectedContextUri?: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch("https://api.spotify.com/v1/me/player", {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 204) {
      if (!expectedPlaying) return true;
    } else if (response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
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

async function playbackAction(
  request: Request,
  path: string,
  method: string,
  body?: unknown,
  success = "Acción completada en Spotify.",
  expectedPlaying?: boolean,
): Promise<ToolResult> {
  const devices = await spotifyRequest(request, "/me/player/devices", "GET");
  if (!devices.response.ok)
    return {
      ok: false,
      message: playbackError(devices.response.status),
      setCookie: devices.setCookie,
    };
  const { deviceId } = await choosePlaybackDevice(devices.accessToken);
  if (!deviceId)
    return {
      ok: false,
      message:
        "No detecté ningún dispositivo Spotify disponible. Abre Spotify en tu PC y vuelve a intentarlo.",
      setCookie: devices.setCookie,
    };
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `https://api.spotify.com/v1${path}${separator}device_id=${encodeURIComponent(deviceId)}`,
    {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${devices.accessToken}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (response.ok || response.status === 204) {
    if (expectedPlaying !== undefined) {
      const confirmed = await waitForPlaybackState(devices.accessToken, expectedPlaying);
      if (!confirmed) {
        return {
          ok: false,
          confirmed: false,
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

/** Previous may restart the current track. Never repeat blindly when state is uncertain. */
async function transportAction(
  request: Request,
  direction: "next" | "previous",
  count: number,
): Promise<ToolResult> {
  let setCookie: string | undefined;
  for (let step = 0; step < count; step++) {
    const before = await spotifyRequest(request, "/me/player", "GET");
    setCookie = before.setCookie ?? setCookie;
    if (!before.response.ok || before.response.status === 204)
      return {
        ok: false,
        message:
          before.response.status === 204
            ? "No hay una pista activa que pueda verificar."
            : playbackError(before.response.status),
        setCookie,
      };
    const state = (await before.response.json()) as {
      item?: { uri?: string };
      device?: { id?: string };
      progress_ms?: number;
      repeat_state?: string;
      shuffle_state?: boolean;
    };
    if (!state.item?.uri || !state.device?.id)
      return {
        ok: false,
        message:
          "Spotify no informó la pista o el dispositivo; no ejecutaré un salto sin poder verificarlo.",
        setCookie,
      };
    if (count === 2 && (state.shuffle_state || state.repeat_state === "track"))
      return {
        ok: false,
        message:
          "Con reproducción aleatoria o repetición de pista no puedo garantizar dos canciones atrás. Desactiva ese modo y vuelve a pedirlo.",
        setCookie,
      };
    const changed = await fetch(
      `https://api.spotify.com/v1/me/player/${direction}?device_id=${encodeURIComponent(state.device.id)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${before.accessToken}` },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!changed.ok) return { ok: false, message: playbackError(changed.status), setCookie };
    let verified = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${before.accessToken}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!after.ok) return { ok: false, message: playbackError(after.status), setCookie };
      const next = (await after.json()) as {
        item?: { uri?: string };
        device?: { id?: string };
        progress_ms?: number;
      };
      if (next.device?.id !== state.device.id)
        return {
          ok: false,
          message: "El dispositivo cambió durante la orden; detuve los pasos restantes.",
          setCookie,
        };
      if (next.item?.uri && next.item.uri !== state.item.uri) {
        verified = true;
        break;
      }
      if (
        direction === "previous" &&
        (state.progress_ms ?? 0) > 3000 &&
        (next.progress_ms ?? Infinity) < 2000
      ) {
        return {
          ok: false,
          confirmed: false,
          message:
            "Spotify reinició la pista actual, no retrocedió a otra canción. Detuve la orden sin repetirla.",
          setCookie,
        };
      }
    }
    if (!verified)
      return {
        ok: false,
        confirmed: false,
        message: `Spotify aceptó el salto ${step + 1}, pero no confirmó una pista distinta. Detuve los pasos restantes sin repetir la acción.`,
        setCookie,
      };
  }
  return {
    ok: true,
    confirmed: true,
    message:
      direction === "next"
        ? "Spotify confirmó la siguiente pista."
        : `Spotify confirmó el retroceso de ${count} ${count === 1 ? "pista" : "pistas"}.`,
    setCookie,
  };
}

export async function executeSpotifyTool(
  request: Request,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "spotify_play_personalized": {
        const session = await readSpotifySession(request);
        if (!session.session)
          return {
            ok: false,
            message: "Spotify no está conectado. Conecta la cuenta desde Ajustes.",
          };
        const fallback = async () => {
          const artists = ["Bad Bunny", "Shakira", "Dua Lipa", "Coldplay", "AC/DC"];
          if (args["different_artist"] === true) {
            const current = await executeSpotifyTool(request, "spotify_current_artist", {});
            if (!current.ok) return current;
            const artist = current.message.replace(/^ARTIST:\s*/i, "").trim();
            const index = artists.findIndex((a) => a.toLowerCase() === artist.toLowerCase());
            if (index >= 0) artists.splice(index, 1);
          }
          const chosen = artists[Math.floor(Math.random() * artists.length)];
          if (!chosen) return { ok: false, message: "No pude elegir un artista del catálogo." };
          const played = await executeSpotifyTool(request, "spotify_search_and_play", {
            query: `artist:${chosen}`,
            kind: "track",
          });
          return { ...played, setCookie: played.setCookie ?? session.setCookie };
        };
        if (!session.session.scope.split(/\s+/).includes("user-top-read")) return fallback();
        const top = await spotifyRequest(
          request,
          "/me/top/tracks?time_range=medium_term&limit=20",
          "GET",
        );
        if (!top.response.ok) {
          if (top.response.status === 403) return fallback();
          return {
            ok: false,
            message: playbackError(top.response.status),
            setCookie: top.setCookie,
          };
        }
        const data = (await top.response.json().catch(() => ({}))) as {
          items?: { name?: string; artists?: { name?: string }[] }[];
        };
        const favorites = (data.items ?? []).filter((item) => item.name && item.artists?.[0]?.name);
        if (!favorites.length) return fallback();
        let candidates = favorites;
        if (args["different_artist"] === true) {
          const current = await spotifyRequest(request, "/me/player", "GET");
          if (current.response.ok) {
            const playing = (await current.response.json().catch(() => ({}))) as {
              item?: { artists?: { name?: string }[] };
            };
            const currentArtist = (playing.item?.artists?.[0]?.name ?? "").toLocaleLowerCase("es");
            if (currentArtist) {
              const alternatives = favorites.filter(
                (item) => (item.artists?.[0]?.name ?? "").toLocaleLowerCase("es") !== currentArtist,
              );
              if (alternatives.length) candidates = alternatives;
            }
          }
        }
        const pool = candidates.slice(0, 10);
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        const artist = chosen?.artists?.[0]?.name;
        if (!chosen?.name || !artist) return fallback();
        const played = await executeSpotifyTool(request, "spotify_search_and_play", {
          query: `track:${chosen.name} artist:${artist}`,
          kind: "track",
        });
        return {
          ...played,
          message: played.ok
            ? `Elegí una canción de tus favoritas: ${chosen.name} de ${artist}. ${played.message}`
            : played.message,
          setCookie: played.setCookie ?? top.setCookie,
        };
      }
      case "spotify_volume": {
        const target =
          typeof args["target"] === "number" && Number.isInteger(args["target"])
            ? Math.max(0, Math.min(100, args["target"]))
            : null;
        const direction =
          args["direction"] === "up" || args["direction"] === "down" ? args["direction"] : null;
        if (target === null && !direction)
          return {
            ok: false,
            message: "Indica un porcentaje exacto o si quieres subir o bajar el volumen.",
          };
        const current = await spotifyRequest(request, "/me/player/devices", "GET");
        if (!current.response.ok)
          return {
            ok: false,
            message: playbackError(current.response.status),
            setCookie: current.setCookie,
          };
        const {
          deviceId,
          volumePercent,
          response: devicesResponse,
        } = await choosePlaybackDevice(current.accessToken);
        if (!devicesResponse.ok)
          return {
            ok: false,
            message: playbackError(devicesResponse.status),
            setCookie: current.setCookie,
          };
        if (!deviceId)
          return {
            ok: false,
            message:
              "No detecté un dispositivo Spotify disponible. Abre Spotify en tu PC y vuelve a intentarlo.",
            setCookie: current.setCookie,
          };
        if (volumePercent === null)
          return {
            ok: false,
            message:
              "Spotify no informó el volumen del dispositivo actual; no puedo calcular ni verificar el cambio.",
            setCookie: current.setCookie,
          };
        const nextVolume =
          target !== null
            ? target
            : Math.max(0, Math.min(100, volumePercent + (direction === "up" ? 10 : -10)));
        if (nextVolume === volumePercent)
          return {
            ok: true,
            message: `El volumen ya está en ${nextVolume}%.`,
            setCookie: current.setCookie,
          };
        const changed = await fetch(
          `https://api.spotify.com/v1/me/player/volume?volume_percent=${nextVolume}&device_id=${encodeURIComponent(deviceId)}`,
          {
            method: "PUT",
            signal: AbortSignal.timeout(12_000),
            headers: { Authorization: `Bearer ${current.accessToken}` },
          },
        );
        if (!changed.ok && changed.status !== 204)
          return {
            ok: false,
            message: playbackError(changed.status),
            setCookie: current.setCookie,
          };
        let confirmed = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const verify = await choosePlaybackDevice(current.accessToken);
          if (
            verify.response.ok &&
            verify.deviceId === deviceId &&
            verify.volumePercent === nextVolume
          ) {
            confirmed = true;
            break;
          }
          if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (!confirmed)
          return {
            ok: false,
            confirmed: false,
            message: `Spotify aceptó el volumen de ${nextVolume}%, pero todavía no actualiza el valor de confirmación. No repetiré el cambio.`,
            setCookie: current.setCookie,
          };
        return {
          ok: true,
          message: `Volumen de Spotify establecido en ${nextVolume}%.`,
          setCookie: current.setCookie,
        };
      }
      case "spotify_search_and_play": {
        const query = typeof args["query"] === "string" ? args["query"].trim().slice(0, 160) : "";
        const kind =
          args["kind"] === "playlist" ? "playlist" : args["kind"] === "track" ? "track" : "";
        if (!query || !kind)
          return {
            ok: false,
            message: "Falta una búsqueda válida y su tipo (canción o playlist).",
          };
        const trackQuery = query.match(/^track:(.*?)\s+artist:(.+)$/i);
        const artistQuery = query.match(/^artist:(.+)$/i);
        const requestedTitle =
          trackQuery?.[1]?.trim() ?? (artistQuery ? "" : query.replace(/^track:/i, "").trim());
        const requestedArtist = trackQuery?.[2]?.trim() ?? artistQuery?.[1]?.trim() ?? "";
        // Spotify interpreta peor los operadores de búsqueda con ciertos signos (AC/DC).
        // Buscamos con texto normal y validamos título/artista sobre los resultados.
        const searchTerm = (
          artistQuery
            ? requestedArtist
            : [requestedTitle, requestedArtist].filter(Boolean).join(" ")
        )
          .replace(/[\/&]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const search = await spotifyRequest(
          request,
          `/search?${new URLSearchParams({ q: searchTerm, type: kind, limit: String(SPOTIFY_SEARCH_LIMIT) }).toString()}`,
          "GET",
        );
        if (!search.response.ok)
          return {
            ok: false,
            message:
              search.response.status === 400
                ? "Spotify rechazó los parámetros de búsqueda; no he reproducido nada."
                : playbackError(search.response.status),
            setCookie: search.setCookie,
          };
        const payload = (await search.response.json().catch(() => ({}))) as {
          tracks?: {
            items?: {
              name?: string;
              uri?: string;
              popularity?: number;
              artists?: { name?: string }[];
              album?: { uri?: string };
            }[];
          };
          playlists?: { items?: { uri?: string }[] };
        };
        const normalize = (value: string) =>
          value
            .toLocaleLowerCase("es")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9 ]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const normalizeArtist = (value: string) => normalize(value).replace(/\s/g, "");
        const wantedTitle = normalize(requestedTitle);
        const wantedArtist = normalizeArtist(requestedArtist);
        const tracks = payload.tracks?.items ?? [];
        const ranked = tracks
          .map((item) => {
            const title = normalize(item.name ?? "");
            const artists = (item.artists ?? []).map((artist) =>
              normalizeArtist(artist.name ?? ""),
            );
            const titleExact = Boolean(wantedTitle) && title === wantedTitle;
            // Permite títulos oficiales con subtítulos entre paréntesis, como Waka Waka (This Time for Africa).
            const titleMatch =
              Boolean(wantedTitle) && (titleExact || title.startsWith(`${wantedTitle} `));
            const artistExact = !wantedArtist || artists.some((artist) => artist === wantedArtist);
            const artistClose =
              !wantedArtist ||
              artists.some(
                (artist) => artist.includes(wantedArtist) || wantedArtist.includes(artist),
              );
            const score =
              (titleExact ? 110 : titleMatch ? 90 : 0) +
              (artistExact && wantedArtist ? 100 : artistClose && wantedArtist ? 35 : 0) +
              (item.popularity ?? 0) / 100;
            return { item, score, titleExact, titleMatch, artistExact, artistClose };
          })
          .sort((a, b) => b.score - a.score);
        const best = ranked.find((candidate) => {
          return trackMatches(
            candidate.item.name ?? "",
            (candidate.item.artists ?? []).map((a) => a.name ?? ""),
            requestedTitle,
            requestedArtist,
          );
        });
        const track = kind === "track" ? best?.item : undefined;
        const uri = kind === "track" ? track?.uri : payload.playlists?.items?.[0]?.uri;
        const albumUri = track?.album?.uri;
        if (!uri) {
          const label = requestedTitle || requestedArtist || query;
          return {
            ok: false,
            message:
              kind === "track"
                ? `No encontré una canción que coincida con “${label}”${requestedArtist ? ` de ${requestedArtist}` : ""}. No he reproducido otra canción.`
                : "No se encontró una playlist reproducible en Spotify.",
            setCookie: search.setCookie,
          };
        }
        const { deviceId, response: devicesResponse } = await choosePlaybackDevice(
          search.accessToken,
        );
        if (!devicesResponse.ok)
          return {
            ok: false,
            message: playbackError(devicesResponse.status),
            setCookie: search.setCookie,
          };
        if (!deviceId)
          return {
            ok: false,
            message:
              "Encontré el contenido, pero no detecté un dispositivo Spotify disponible. Abre Spotify en tu PC y vuelve a intentarlo.",
            setCookie: search.setCookie,
          };
        const playedResponse = await fetch(
          `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
          {
            method: "PUT",
            signal: AbortSignal.timeout(15_000),
            headers: {
              Authorization: `Bearer ${search.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              kind === "track" && albumUri
                ? { context_uri: albumUri, offset: { uri } }
                : kind === "track"
                  ? { uris: [uri] }
                  : { context_uri: uri },
            ),
          },
        );
        if (playedResponse.ok || playedResponse.status === 204) {
          const confirmed = await waitForPlaybackState(
            search.accessToken,
            true,
            kind === "track" ? uri : undefined,
            kind === "playlist" ? uri : undefined,
          );
          const playedLabel = artistQuery
            ? `Spotify está reproduciendo “${track?.name ?? "una canción"}” de ${
                (track?.artists ?? [])
                  .map((artist) => artist.name)
                  .filter(Boolean)
                  .join(", ") || requestedArtist
              }.`
            : requestedArtist
              ? `Spotify está reproduciendo “${track?.name ?? requestedTitle}” de ${(
                  track?.artists ?? []
                )
                  .map((artist) => artist.name)
                  .filter(Boolean)
                  .join(", ")}.`
              : `Spotify está reproduciendo “${track?.name ?? requestedTitle}”.`;
          return {
            ok: confirmed,
            confirmed,
            message: confirmed
              ? playedLabel
              : "Spotify aceptó la solicitud, pero no pude confirmar la reproducción. No repetiré la orden.",
            setCookie: search.setCookie,
          };
        }
        return {
          ok: false,
          message: playbackError(playedResponse.status),
          setCookie: search.setCookie,
        };
      }
      case "spotify_resume":
        return playbackAction(
          request,
          "/me/player/play",
          "PUT",
          undefined,
          "Spotify confirmó que la reproducción está activa.",
          true,
        );
      case "spotify_pause":
        return playbackAction(
          request,
          "/me/player/pause",
          "PUT",
          undefined,
          "Spotify confirmó que la reproducción está pausada.",
          false,
        );
      case "spotify_next":
        return transportAction(request, "next", 1);
      case "spotify_previous":
        return transportAction(request, "previous", args["count"] === 2 ? 2 : 1);
      case "spotify_play_current_artist": {
        const current = await spotifyRequest(request, "/me/player", "GET");
        if (current.response.status === 204)
          return {
            ok: false,
            message: "No hay ninguna canción sonando para identificar al artista.",
            setCookie: current.setCookie,
          };
        if (!current.response.ok)
          return {
            ok: false,
            message: playbackError(current.response.status),
            setCookie: current.setCookie,
          };
        const playing = (await current.response.json().catch(() => ({}))) as {
          item?: { uri?: string; artists?: { name?: string }[] };
        };
        const artist = playing.item?.artists?.[0]?.name?.trim();
        const currentUri = playing.item?.uri;
        if (!artist || !currentUri)
          return {
            ok: false,
            message: "No pude identificar la canción y el artista actuales.",
            setCookie: current.setCookie,
          };
        const searchTerm = artist.replace(/[\\/&]/g, " ").replace(/\s+/g, " ").trim();
        const search = await spotifyRequest(
          request,
          `/search?${new URLSearchParams({ q: searchTerm, type: "track", limit: String(SPOTIFY_SEARCH_LIMIT) }).toString()}`,
          "GET",
        );
        if (!search.response.ok)
          return {
            ok: false,
            message: playbackError(search.response.status),
            setCookie: search.setCookie ?? current.setCookie,
          };
        const results = (await search.response.json().catch(() => ({}))) as {
          tracks?: { items?: { name?: string; uri?: string; artists?: { name?: string }[] }[] };
        };
        const artistKey = normalizeMusic(artist).replace(/\s/g, "");
        const candidate = (results.tracks?.items ?? []).find(
          (track) =>
            Boolean(track.uri) &&
            track.uri !== currentUri &&
            (track.artists ?? []).some(
              (item) => normalizeMusic(item.name ?? "").replace(/\s/g, "") === artistKey,
            ),
        );
        if (!candidate?.uri)
          return {
            ok: false,
            message: `No encontré otra canción disponible de ${artist} en los primeros resultados de Spotify.`,
            setCookie: search.setCookie ?? current.setCookie,
          };
        const device = await choosePlaybackDevice(search.accessToken);
        if (!device.response.ok)
          return {
            ok: false,
            message: playbackError(device.response.status),
            setCookie: search.setCookie ?? current.setCookie,
          };
        if (!device.deviceId)
          return {
            ok: false,
            message: "No detecté un dispositivo Spotify disponible. Abre Spotify y vuelve a intentarlo.",
            setCookie: search.setCookie ?? current.setCookie,
          };
        const played = await fetch(
          `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device.deviceId)}`,
          {
            method: "PUT",
            signal: AbortSignal.timeout(15_000),
            headers: {
              Authorization: `Bearer ${search.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: [candidate.uri] }),
          },
        );
        if (!played.ok && played.status !== 204)
          return {
            ok: false,
            message: playbackError(played.status),
            setCookie: search.setCookie ?? current.setCookie,
          };
        const confirmed = await waitForPlaybackState(search.accessToken, true, candidate.uri);
        return {
          ok: confirmed,
          confirmed,
          message: confirmed
            ? `Spotify está reproduciendo otra canción de ${artist}: “${candidate.name ?? "una canción"}”.`
            : "Spotify aceptó la orden, pero no pude confirmar una pista distinta. No repetiré la acción.",
          setCookie: search.setCookie ?? current.setCookie,
        };
      }
      case "spotify_current_artist": {
        const { response, setCookie } = await spotifyRequest(request, "/me/player", "GET");
        if (response.status === 204)
          return {
            ok: false,
            message: "No hay ninguna canción sonando en Spotify ahora mismo.",
            setCookie,
          };
        if (!response.ok) return { ok: false, message: playbackError(response.status), setCookie };
        const payload = (await response.json().catch(() => ({}))) as {
          item?: { artists?: { name?: string }[] };
        };
        const artist = payload.item?.artists?.[0]?.name;
        return artist
          ? { ok: true, message: `ARTIST: ${artist}`, setCookie }
          : {
              ok: false,
              message: "No pude identificar al artista de la canción actual.",
              setCookie,
            };
      }
      case "spotify_playback_status": {
        const { response, setCookie } = await spotifyRequest(request, "/me/player", "GET");
        if (response.status === 204)
          return {
            ok: true,
            message: "Spotify no tiene reproducción activa en este momento.",
            setCookie,
          };
        if (!response.ok) return { ok: false, message: playbackError(response.status), setCookie };
        const payload = (await response.json().catch(() => ({}))) as { is_playing?: boolean };
        return {
          ok: true,
          message: payload.is_playing ? "Spotify está reproduciendo." : "Spotify está pausado.",
          setCookie,
        };
      }
      default:
        return {
          ok: false,
          message: "Nemotron solicitó una herramienta de Spotify no reconocida.",
        };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo conectar con Spotify.",
    };
  }
}
