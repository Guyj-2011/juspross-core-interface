/** Configuración compartida de Gemini Live (sin secretos). */
export const GEMINI_LIVE_MODEL = "models/gemini-3.8-live";
export const GEMINI_LIVE_VOICE = "Algieba";
export const GEMINI_LIVE_WS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
export const GEMINI_LIVE_SYSTEM =
  "Eres Juspross 2.0, una inteligencia artificial serena y precisa. Habla siempre en español con voz masculina, " +
  "compuesta, cálida y natural. Responde de forma breve (2 a 4 frases) salvo que te pidan más detalle.";
export const LIVE_INPUT_RATE = 16000;
export const LIVE_OUTPUT_RATE = 24000;

/** Convierte Float32 [-1,1] a PCM16 little-endian, remuestreando por promedio. */
export function floatToPcm16(input: Float32Array, fromRate: number, toRate = LIVE_INPUT_RATE): Int16Array {
  const ratio = fromRate / toRate;
  const len = Math.floor(input.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio)) || start + 1;
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    const s = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
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
