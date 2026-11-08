/** Detecta SOLO la intención de abrir la app de Spotify. Reproducir/pausar/etc. siguen por la API de Spotify. */
const OPEN = /\b(abre|abrir|abreme|abrime|inicia|iniciar|lanza|lanzar|arranca|arrancar|ejecuta|open|launch|start)\b/;
const PLAYBACK = /\b(reproduc\w*|pon|ponme|poner|play|pausa\w*|para|detén|deten|siguiente|anterior|salta\w*|reanuda\w*|cancion\w*|tema|playlist|lista|musica|artista|album|volumen|next|pause|resume)\b/;

export function isOpenSpotifyIntent(text: string): boolean {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!/\bspotify\b/.test(t) || !OPEN.test(t)) return false;
  return !PLAYBACK.test(t);
}
