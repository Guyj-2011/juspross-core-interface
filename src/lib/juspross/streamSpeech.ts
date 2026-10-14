import { createParser } from "eventsource-parser";

export function decodePCM(pending: Uint8Array, incoming: Uint8Array) {
  const bytes = new Uint8Array(pending.length + incoming.length);
  bytes.set(pending);
  bytes.set(incoming, pending.length);
  const usable = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(usable / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return { samples, pending: bytes.slice(usable) };
}

export async function streamSpeech(endpoint: string, text: string, signal?: AbortSignal, onLevel: (level: number) => void = () => {}): Promise<void> {
  signal?.throwIfAborted();
  const context = new AudioContext({ sampleRate: 24000 });
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(context.destination);
  const waveform = new Uint8Array(analyser.fftSize);
  let raf = 0;
  const meter = () => {
    analyser.getByteTimeDomainData(waveform);
    let power = 0;
    for (const sample of waveform) power += ((sample - 128) / 128) ** 2;
    onLevel(Math.min(1, Math.sqrt(power / waveform.length) * 3));
    raf = requestAnimationFrame(meter);
  };
  const sources = new Set<AudioBufferSourceNode>();
  let playhead = 0;
  let pending = new Uint8Array(0);
  let completed = false;
  let samplesPlayed = 0;
  const controller = new AbortController();
  const abort = () => {
    controller.abort(signal?.reason);
    for (const source of sources) source.stop();
  };
  signal?.addEventListener("abort", abort, { once: true });
  let playback: Promise<void> = Promise.resolve();
  try {
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") throw new Error("El navegador no permitió reproducir la voz. Activa el sonido y vuelve a intentarlo.");
    meter();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const raw = await response.text();
      let message = raw;
      try { const error = JSON.parse(raw); message = error.message ?? error.error?.message ?? raw; } catch { /* plain message */ }
      throw new Error(message || `No se pudo generar la voz (${response.status}).`);
    }
    const parser = createParser({
      onEvent(event) {
        const payload = JSON.parse(event.data) as { type: string; audio?: string; error?: unknown };
        if (payload.type === "error" || payload.error) throw new Error(typeof payload.error === "object" && payload.error && "message" in payload.error ? String(payload.error.message) : `No se pudo generar la voz: ${event.data}`);
        if (payload.type === "speech.audio.done") {
          completed = true;
          return;
        }
        if (payload.type !== "speech.audio.delta") return;
        if (completed || !payload.audio) throw new Error("Invalid speech audio event");
        const decoded = decodePCM(
          pending,
          Uint8Array.from(atob(payload.audio), (c) => c.charCodeAt(0)),
        );
        pending = new Uint8Array(decoded.pending);
        if (!decoded.samples.length) return;
        samplesPlayed += decoded.samples.length;
        const buffer = context.createBuffer(1, decoded.samples.length, 24000);
        buffer.copyToChannel(decoded.samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(analyser);
        sources.add(source);
        playback = new Promise<void>((resolve) => {
          source.onended = () => {
            sources.delete(source);
            resolve();
          };
        });
        // Device startup can clip audio scheduled exactly at currentTime.
        playhead = Math.max(playhead, context.currentTime + 0.05);
        source.start(playhead);
        playhead += buffer.duration;
      },
    });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        parser.feed(next.value);
      }
      parser.reset({ consume: true });
    } finally {
      reader.releaseLock();
    }
    if (!completed || !samplesPlayed || pending.length) throw new Error("Incomplete speech stream");
    await playback;
    signal?.throwIfAborted();
  } finally {
    cancelAnimationFrame(raf);
    onLevel(0);
    signal?.removeEventListener("abort", abort);
    controller.abort();
    for (const source of sources) source.stop();
    await context.close();
  }
}
