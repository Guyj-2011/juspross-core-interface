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
  u.lang = "es-ES";
  u.rate = 1.02;
  u.pitch = 0.92;
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find((x) => x.lang.startsWith("es"));
  if (v) u.voice = v;

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