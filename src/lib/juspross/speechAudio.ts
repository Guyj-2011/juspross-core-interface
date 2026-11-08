let sharedContext: AudioContext | null = null;
let listenersInstalled = false;

function resumeSharedContext() {
  if (sharedContext?.state === "suspended") {
    void sharedContext.resume().catch(() => {});
  }
}

/** Reutiliza un único contexto de salida para evitar bloqueos de autoplay entre respuestas. */
export function getSpeechAudioContext(): AudioContext {
  if (typeof window === "undefined") throw new Error("El audio solo está disponible en el navegador.");
  if (!sharedContext || sharedContext.state === "closed") {
    sharedContext = new AudioContext({ sampleRate: 24_000 });
  }
  if (!listenersInstalled) {
    window.addEventListener("focus", resumeSharedContext);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resumeSharedContext();
    });
    listenersInstalled = true;
  }
  return sharedContext;
}

/** Debe llamarse directamente desde el gesto del usuario, antes de iniciar tareas asíncronas. */
export function unlockSpeechAudio(): void {
  try {
    const context = getSpeechAudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    // streamSpeech mostrará un error claro si el navegador no admite audio.
  }
}
