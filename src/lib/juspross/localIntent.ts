import { parseSpotifyCommands } from "./spotifyCommands";
/** Detecta las órdenes de Spotify que deben pasar por Nemotron. */
const OPEN = /\b(abre|abrir|abreme|abrime|inicia|iniciar|lanza|lanzar|arranca|arrancar|ejecuta|open|launch|start)\b/;
const TARGET = /\b(spotify|musica|cancion|playlist|artista|album|reproduccion|tema|volumen)\b/;
const SHORT_PLAYBACK = /^\s*(pausa|pausar|reanuda|reanudar|play|reproducir|siguiente|anterior|avanza|retrocede|salta a la siguiente|pasa a la siguiente|sube el volumen|baja el volumen|sube volumen|baja volumen|más volumen|menos volumen)\s*[.!?]*$/;

function normalize(text: string): string {
  return text.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export type SpotifyWindowAction = "minimize" | "maximize" | "close";

/** Detecta órdenes explícitas para controlar la ventana de Spotify en Windows. */
export function getSpotifyWindowAction(text: string, context = ""): SpotifyWindowAction | null {
  const value = normalize(text);
  const hasSpotifyContext = /\bspotify\b/.test(normalize(context));
  if (!/\bspotify\b/.test(value) && !hasSpotifyContext) return null;
  if (/\b(pestana|navegador|chat)\b/.test(value)) return null;
  if (/\b(minimiza\w*|oculta\w*|reduce la ventana)\b/.test(value)) return "minimize";
  if (/\b(maximiza\w*|pantalla completa|a pantalla completa|toda la pantalla|hazla pantalla completa|ponla en pantalla completa|agranda la ventana)\b/.test(value)) return "maximize";
  if (/\b(cierra\w*|cerrar|salir de|sal del)\b/.test(value)) return "close";
  return null;
}

/** Detecta si además de reproducir, el usuario pidió abrir Spotify en Windows. */
export function requestsSpotifyOpen(text: string, context = ""): boolean {
  const value = normalize(text);
  const hasSpotifyContext = /\bspotify\b/.test(normalize(context));
  const mentionsSpotify = /\bspotify\b/.test(value) || hasSpotifyContext;
  return mentionsSpotify && /\b(abre\w*|abrir|inicia\w*|iniciar|lanza\w*|lanzar)\b/.test(value);
}

/** Solo detecta abrir la aplicación; no confunde «abre Spotify y reproduce…» con abrir solamente. */
export function isOpenSpotifyIntent(text: string): boolean {
  const value = normalize(text);
  if (!/\bspotify\b/.test(value) || !OPEN.test(value)) return false;
  const playback = /\b(reproduc\w*|pon|ponme|play|pausa\w*|siguiente|anterior|reanuda\w*|cancion|tema|playlist|musica|artista)\b/.test(value);
  return !playback;
}

/** Envía a Nemotron tanto la apertura de Spotify como sus órdenes de reproducción. */
export function isSpotifyRequest(text: string, context = ""): boolean {
  const value = normalize(text);
  if (getSpotifyWindowAction(text, context)) return true;
  const hasSpotifyContext = /\bspotify\b/.test(normalize(context));
  if (hasSpotifyContext && /\b(sub\w*|baj\w*|ajusta\w*|ponlo|dejalo)\b.*\b(?:al|a|hasta|en)\s+(?:el\s+)?\d{1,3}/.test(value)) return true;
  if (isOpenSpotifyIntent(text)) return true;
  if (SHORT_PLAYBACK.test(value) || parseSpotifyCommands(text)) return true;
  const action = /\b(reproduc\w*|pon|ponme|poner|play|pausa\w*|para|deten|siguiente|anterior|avanza|retrocede|salta|reanuda\w*|sube|baja|aumenta|disminuye|abre|abrir|inicia|iniciar|lanza|lanzar|arranca|arrancar|ejecuta|open|launch|start|que suena|que esta sonando)\b/.test(value);
  return action && TARGET.test(value);
}
