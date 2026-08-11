/** Sonidos extremadamente sutiles + análisis de amplitud para el núcleo. */
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

type Cue = "boot" | "activate" | "interact" | "complete" | "error";

const CUES: Record<Cue, { f: number[]; dur: number; gain: number; type: OscillatorType }> = {
  boot: { f: [180, 420, 720], dur: 0.9, gain: 0.05, type: "sine" },
  activate: { f: [520, 780], dur: 0.28, gain: 0.045, type: "sine" },
  interact: { f: [880], dur: 0.09, gain: 0.028, type: "triangle" },
  complete: { f: [660, 990], dur: 0.35, gain: 0.04, type: "sine" },
  error: { f: [220, 165], dur: 0.4, gain: 0.05, type: "sawtooth" },
};

export function cue(name: Cue, enabled = true) {
  if (!enabled) return;
  const a = ac();
  if (!a) return;
  const spec = CUES[name];
  spec.f.forEach((freq, i) => {
    const osc = a.createOscillator();
    const g = a.createGain();
    const filter = a.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 4200;
    osc.type = spec.type;
    osc.frequency.value = freq;
    const t0 = a.currentTime + i * 0.07;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(spec.gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
    osc.connect(filter).connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + spec.dur + 0.05);
  });
}

/** Analiza el micrófono y devuelve amplitud 0..1 en cada frame. */
export async function createMicAnalyser(onLevel: (v: number) => void) {
  const a = ac();
  if (!a) throw new Error("Audio no disponible");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const src = a.createMediaStreamSource(stream);
  const analyser = a.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const loop = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      sum += v * v;
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    src.disconnect();
  };
}