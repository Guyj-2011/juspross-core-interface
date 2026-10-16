import { create } from "zustand";

export type Mode = "calm" | "v2";
export type V2State = "idle" | "thinking" | "speaking" | "error";
/** simulated = sin IA conectada · online = Qwen respondiendo · offline = no se alcanzó */
export type AiLink = "simulated" | "checking" | "online" | "offline";

export interface V2Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  simulated?: boolean;
  error?: boolean;
}

const KEY = "juspross.v2";
const uid = () => Math.random().toString(36).slice(2, 10);

interface V2Store {
  mode: Mode;
  state: V2State;
  amplitude: number;
  messages: V2Message[];
  aiEndpoint: string;
  /** Modelo fijado por defecto para el lado 2.0. */
  aiModel: string;
  aiLink: AiLink;
  aiDetail: string;
  voiceReplies: boolean;

  hydrate: () => void;
  setMode: (m: Mode) => void;
  setState: (s: V2State) => void;
  setAmplitude: (v: number) => void;
  addMessage: (m: Omit<V2Message, "id">) => string;
  patchMessage: (id: string, patch: Partial<V2Message>) => void;
  clear: () => void;
  setAi: (p: { endpoint?: string; model?: string }) => void;
  setLink: (l: AiLink, detail?: string) => void;
  setVoiceReplies: (v: boolean) => void;
}

function persist(s: V2Store) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        mode: s.mode,
        endpoint: s.aiEndpoint,
        model: s.aiModel,
        voice: s.voiceReplies,
      }),
    );
  } catch {
    /* almacenamiento no disponible */
  }
}

export const useV2 = create<V2Store>((set, get) => ({
  mode: "calm",
  state: "idle",
  amplitude: 0,
  messages: [],
  aiEndpoint: "http://localhost:11434",
  aiModel: "qwen3:8b",
  aiLink: "simulated",
  aiDetail: "Qwen aún no está conectado: las respuestas son simuladas.",
  voiceReplies: false,

  hydrate: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as {
        mode?: Mode;
        endpoint?: string;
        model?: string;
        voice?: boolean;
      };
      set({
        mode: p.mode === "v2" ? "v2" : "calm",
        aiEndpoint: p.endpoint || "http://localhost:11434",
        aiModel: p.model?.trim() || "qwen3:8b",
        voiceReplies: !!p.voice,
      });
    } catch {
      /* datos corruptos: se ignoran */
    }
  },
  setMode: (mode) => {
    set({ mode });
    persist(get());
  },
  setState: (state) => set({ state }),
  setAmplitude: (amplitude) => set({ amplitude }),
  addMessage: (m) => {
    const id = uid();
    set((s) => ({ messages: [...s.messages.slice(-60), { ...m, id }] }));
    return id;
  },
  patchMessage: (id, patch) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  clear: () => set({ messages: [] }),
  setAi: ({ endpoint, model }) => {
    set((s) => ({
      aiEndpoint: (endpoint ?? s.aiEndpoint).trim().replace(/\/+$/, "") || "http://localhost:11434",
      aiModel: (model ?? s.aiModel).trim() || "qwen3:8b",
      aiLink: "simulated",
      aiDetail: "Configuración cambiada: pulsa «Probar conexión».",
    }));
    persist(get());
  },
  setLink: (aiLink, detail) => set((s) => ({ aiLink, aiDetail: detail ?? s.aiDetail })),
  setVoiceReplies: (voiceReplies) => {
    set({ voiceReplies });
    persist(get());
  },
}));
