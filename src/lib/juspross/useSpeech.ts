import { useCallback, useEffect, useRef } from "react";

/* Web Speech API — tipos mínimos */
interface SRAlternative { transcript: string }
interface SRResult { 0: SRAlternative; isFinal: boolean; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getSR(): (new () => SRLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SRLike;
    webkitSpeechRecognition?: new () => SRLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => getSR() !== null;

interface Opts {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onWake: () => void;
  onError: (msg: string) => void;
  wakeWord?: string;
}

/** Reconocimiento continuo con palabra de activación "Hey Juspross". */
export function useSpeechRecognition({ onInterim, onFinal, onWake, onError, wakeWord = "juspross" }: Opts) {
  const recRef = useRef<SRLike | null>(null);
  const runningRef = useRef(false);
  const awakeRef = useRef(false);
  const cbs = useRef({ onInterim, onFinal, onWake, onError });
  cbs.current = { onInterim, onFinal, onWake, onError };

  const stop = useCallback(() => {
    runningRef.current = false;
    recRef.current?.abort();
    recRef.current = null;
  }, []);

  const start = useCallback(() => {
    const Ctor = getSR();
    if (!Ctor) {
      cbs.current.onError("Este navegador no expone reconocimiento de voz");
      return;
    }
    if (runningRef.current) return;
    const rec = new Ctor();
    rec.lang = "es-ES";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      const probe = (final + " " + interim).toLowerCase();
      if (!awakeRef.current && probe.includes(wakeWord)) {
        awakeRef.current = true;
        cbs.current.onWake();
      }
      if (!awakeRef.current) return;
      const strip = (s: string) =>
        s.replace(/^\s*(hey|oye|hola)?[,\s]*juspross[,\s]*/i, "").trim();
      if (interim) cbs.current.onInterim(strip(interim));
      if (final.trim()) {
        const clean = strip(final);
        awakeRef.current = false;
        if (clean) cbs.current.onFinal(clean);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      cbs.current.onError(
        e.error === "not-allowed" ? "Micrófono bloqueado por el navegador" : `Voz: ${e.error}`,
      );
    };
    rec.onend = () => {
      if (runningRef.current) {
        try {
          rec.start();
        } catch {
          /* reinicio en carrera */
        }
      }
    };
    runningRef.current = true;
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* ya iniciado */
    }
  }, [wakeWord]);

  const forceWake = useCallback(() => {
    awakeRef.current = true;
  }, []);

  useEffect(() => () => stop(), [stop]);
  return { start, stop, forceWake };
}

/** Síntesis de voz + amplitud sintética coherente con el habla. */
export function speak(
  text: string,
  onLevel: (v: number) => void,
  onEnd: () => void,
): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd();
    return () => {};
  }
  const u = new SpeechSynthesisUtterance(text);
  // Perfil calmado: español latino, voz masculina si el navegador ofrece una,
  // ritmo pausado y tono grave sin forzar una voz artificial.
  u.lang = "es-MX";
  u.rate = 0.94;
  u.pitch = 0.82;
  u.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const spanishVoices = voices.filter((voice) => /^es([-_]|$)/i.test(voice.lang));
  const preferredVoice = spanishVoices.find((voice) =>
    /mexic|\bes[-_]mx\b|latin.?america|es[-_]419/i.test(`${voice.name} ${voice.lang}`),
  );
  const maleVoice = spanishVoices.find((voice) =>
    /jorge|raul|raúl|pablo|antonio|diego|andres|andrés|carlos|miguel|enrique|male|masculin/i.test(voice.name),
  );
  const spanishVoice = preferredVoice ?? maleVoice ?? spanishVoices.find((voice) => /^es[-_]es/i.test(voice.lang)) ?? spanishVoices[0];
  if (spanishVoice) {
    u.voice = spanishVoice;
    u.lang = spanishVoice.lang;
  }

  let raf = 0;
  let t = 0;
  let target = 0.5;
  let level = 0;
  const tick = () => {
    t += 1 / 60;
    if (Math.random() < 0.06) target = 0.25 + Math.random() * 0.75;
    const syllable = 0.5 + 0.5 * Math.sin(t * 15.5 + Math.sin(t * 4.1) * 2.0);
    level += (target * syllable - level) * 0.25;
    onLevel(Math.max(0, Math.min(1, level)));
    raf = requestAnimationFrame(tick);
  };

  u.onstart = () => tick();
  const finish = () => {
    cancelAnimationFrame(raf);
    onLevel(0);
    onEnd();
  };
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  // fallback: si la síntesis no está disponible, cerrar el estado
  const guard = setTimeout(() => {
    if (!window.speechSynthesis.speaking) finish();
  }, 900);
  return () => {
    clearTimeout(guard);
    cancelAnimationFrame(raf);
    window.speechSynthesis.cancel();
    onLevel(0);
  };
}

/**
 * Voz del lado calmado: usa el servidor neuronal XTTS local cuando está disponible.
 * Si no lo está, recurre a la voz del navegador para no dejar la interfaz muda.
 * XTTS debe responder audio binario en POST http://127.0.0.1:8000/tts con { text }.
 */
export function speakCalm(
  text: string,
  onLevel: (v: number) => void,
  onEnd: () => void,
): () => void {
  if (typeof window === "undefined") return speak(text, onLevel, onEnd);

  const controller = new AbortController();
  let cancelled = false;
  let finished = false;
  let fallbackStarted = false;
  let fallbackCancel: (() => void) | null = null;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let raf = 0;
  let timer = 0;
  let timedOut = false;
  let t = 0;
  let level = 0;
  let target = 0.45;

  const clearPlayback = () => {
    cancelAnimationFrame(raf);
    if (audio) {
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const finish = () => {
    if (finished || cancelled) return;
    finished = true;
    window.clearTimeout(timer);
    cancelAnimationFrame(raf);
    onLevel(0);
    onEnd();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const tick = () => {
    t += 1 / 60;
    if (Math.random() < 0.06) target = 0.2 + Math.random() * 0.7;
    const syllable = 0.5 + 0.5 * Math.sin(t * 13.5 + Math.sin(t * 3.7) * 1.8);
    level += (target * syllable - level) * 0.22;
    onLevel(Math.max(0, Math.min(1, level)));
    raf = requestAnimationFrame(tick);
  };

  const fallback = () => {
    if (cancelled || finished || fallbackStarted) return;
    fallbackStarted = true;
    window.clearTimeout(timer);
    clearPlayback();
    fallbackCancel = speak(text, onLevel, onEnd);
  };

  timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);

  void fetch("http://127.0.0.1:8000/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: controller.signal,
  })
    .then(async (response) => {
      window.clearTimeout(timer);
      if (!response.ok) throw new Error(`XTTS respondió ${response.status}`);
      const blob = await response.blob();
      if (cancelled) return;
      if (blob.size < 64) throw new Error("XTTS devolvió un audio vacío");
      objectUrl = URL.createObjectURL(blob);
      audio = new Audio(objectUrl);
      audio.preload = "auto";
      audio.onplay = tick;
      audio.onended = finish;
      audio.onerror = fallback;
      try {
        await audio.play();
      } catch {
        fallback();
      }
    })
    .catch(() => {
      if (cancelled) return;
      if (timedOut || !fallbackStarted) fallback();
    });

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    controller.abort();
    fallbackCancel?.();
    clearPlayback();
    onLevel(0);
  };
}
