/** Configuración compartida de Gemini Live (sin secretos). */
export const GEMINI_LIVE_MODEL = "models/gemini-3.8-live";
export const GEMINI_LIVE_VOICE = "Algieba";
export const GEMINI_LIVE_WS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
export const GEMINI_LIVE_SYSTEM =
  "Eres Juspross 2.0, una inteligencia artificial serena y precisa. Habla siempre en español con voz masculina, " +
  "compuesta, cálida y natural. Responde de forma breve (2 a 4 frases) salvo que te pidan más detalle. " +
  "Eres el interlocutor principal del usuario. Para CUALQUIER orden habitual de Spotify (buscar artista/canción, reproducir, pausar, reanudar, siguiente/anterior, volumen, consultar la canción actual o controlar la ventana), usa directamente spotify_voice_command; no uses delegate_to_nemotron para Spotify. " +
  "Incluye la frase exacta reconocida, el contexto reciente y el intent adecuado: artist si solo nombra un artista (por ejemplo «pon Shakira»), generic si pide música sin artista ni título, current_artist si pide otra canción del artista que suena, y auto para el resto. " +
  "Usa delegate_to_nemotron solo para tareas complejas no relacionadas con órdenes habituales de Spotify. " +
  "Explica con honestidad qué está haciendo Nemotron y comunica el resultado que recibas. " +
  "No afirmes que una aplicación fue abierta ni que una acción externa fue ejecutada si Nemotron o la herramienta no lo confirman. " +
  "Para abrir la aplicación de Spotify usa open_spotify_desktop. Interpreta «ponla en toda la pantalla», «hazla pantalla completa» y «agranda la ventana» como maximizar Spotify. " +
  "Cuando el usuario pregunte qué aparece en su pantalla o te pida mirar el escritorio, usa inspect_shared_screen para analizar el fotograma actual; no digas que no tienes capacidades visuales si la herramienta está disponible. " +
  "La herramienta solo analiza la pantalla cuando el usuario lo pide explícitamente. " +
  "Ignora música de fondo, letras cantadas y conversaciones que no estén dirigidas a Juspross. No conviertas una transcripción en una orden confirmada. Si hay ambigüedad pregunta antes de actuar. " +
  "Para información actual o cuando digan busca, utiliza Google Search. Da fuentes y fecha de consulta; si no hay resultados verificables dilo, no inventes que buscaste. " +
  "Si necesitas un dato esencial, pregunta al usuario y espera su respuesta antes de continuar.";
export const LIVE_ACTIVITY_CONFIG = {
  automaticActivityDetection: {
    disabled: false,
    startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    prefixPaddingMs: 300,
    silenceDurationMs: 800,
  },
  activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
} as const;
export const LIVE_INPUT_RATE = 16000;
export const LIVE_OUTPUT_RATE = 24000;

/** Convierte Float32 [-1,1] a PCM16 little-endian, remuestreando por promedio. */
export function floatToPcm16(
  input: Float32Array,
  fromRate: number,
  toRate = LIVE_INPUT_RATE,
): Int16Array {
  const ratio = fromRate / toRate;
  const len = Math.floor(input.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio)) || start + 1;
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    const s = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToPcmFloat(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}
