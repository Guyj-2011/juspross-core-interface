/** Detecta las órdenes de Spotify que deben pasar por Nemotron. */
const OPEN = /\b(abre|abrir|abreme|abrime|inicia|iniciar|lanza|lanzar|arranca|arrancar|ejecuta|open|launch|start)\b/;
const TARGET = /\b(spotify|musica|cancion|playlist|artista|album|reproduccion|tema)\b/;
const SHORT_PLAYBACK = /^\s*(pausa|pausar|reanuda|reanudar|siguiente|anterior|avanza|retrocede|salta a la siguiente|pasa a la siguiente)\s*[.!?]*$/;

function normalize(text: string): string {
  return text.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Solo detecta abrir la aplicación; no confunde «abre Spotify y reproduce…» con abrir solamente. */
export function isOpenSpotifyIntent(text: string): boolean {
  const value = normalize(text);
  if (!/\bspotify\b/.test(value) || !OPEN.test(value)) return false;
  const playback = /\b(reproduc\w*|pon|ponme|play|pausa\w*|siguiente|anterior|reanuda\w*|cancion|tema|playlist|musica|artista)\b/.test(value);
  return !playback;
}

/** Envía a Nemotron tanto la apertura de Spotify como sus órdenes de reproducción. */
export function isSpotifyRequest(text: string): boolean {
  const value = normalize(text);
  if (isOpenSpotifyIntent(text)) return true;
  if (SHORT_PLAYBACK.test(value)) return true;
  const action = /\b(reproduc\w*|pon|ponme|poner|play|pausa\w*|para|deten|siguiente|anterior|avanza|retrocede|salta|reanuda\w*|abre|abrir|inicia|iniciar|lanza|lanzar|arranca|arrancar|ejecuta|open|launch|start|que suena|que esta sonando)\b/.test(value);
  return action && TARGET.test(value);
}
