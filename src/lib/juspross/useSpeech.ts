import { streamSpeech } from "./streamSpeech";
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
        const r = e.results[i];
        if (!r) continue;
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

/** Voz local durante desarrollo; la web publicada usa la voz instalada en el navegador. */
export function speak(
  text: string,
  onLevel: (v: number) => void,
  onEnd: () => void,
  onUnavailable?: (reason: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  onLevel(0);

  if (import.meta.env.PROD) {
    if (!("speechSynthesis" in window)) {
      onUnavailable?.("Este navegador no dispone de síntesis de voz.");
      return () => {};
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-MX";
    utterance.rate = 0.96;
    utterance.pitch = 0.92;
    const voices = window.speechSynthesis.getVoices();
    const spanishVoice = voices.find((voice) => voice.lang.toLowerCase() === "es-mx")
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("es-"))
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("es"));
    if (spanishVoice) utterance.voice = spanishVoice;
    utterance.onend = () => onEnd();
    utterance.onerror = (event) => {
      if (event.error !== "canceled" && event.error !== "interrupted") {
        onUnavailable?.("No se pudo reproducir la voz del navegador.");
      }
    };
    window.speechSynthesis.speak(utterance);
    return () => {
      window.speechSynthesis.cancel();
      onLevel(0);
    };
  }

  const controller = new AbortController();
  void streamSpeech("/api/speech", text, controller.signal, onLevel)
    .then(() => { if (!controller.signal.aborted) onEnd(); })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      onLevel(0);
      onUnavailable?.(error instanceof Error ? error.message : "No se pudo generar la voz.");
    });
  return () => { controller.abort(); onLevel(0); };
}

export const speakCalm = speak;
