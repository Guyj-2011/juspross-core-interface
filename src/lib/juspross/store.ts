import { create } from "zustand";
import type {
  ActivityEntry,
  Agent,
  ChatMessage,
  ConnectionState,
  Conversation,
  DebugEvent,
  PanelId,
  Short,
  SystemState,
} from "./types";
import { INITIAL_AGENTS, INITIAL_SHORTS, SEED_CONVERSATIONS } from "./seed";

const uid = () => Math.random().toString(36).slice(2, 10);

interface JusprossState {
  booted: boolean;
  authed: boolean;
  systemState: SystemState;
  statusLabel: string;
  transcript: string;
  interim: boolean;
  micEnabled: boolean;
  wakeArmed: boolean;
  amplitude: number;
  error: string | null;
  openPanels: PanelId[];
  sidebarOpen: boolean;
  agents: Agent[];
  activity: ActivityEntry[];
  debug: DebugEvent[];
  shorts: Short[];
  reviewShortId: string | null;
  conversations: Conversation[];
  activeConversationId: string;
  webhookUrl: string;
  connection: ConnectionState;
  soundEnabled: boolean;
  quality: "high" | "balanced" | "low";

  setBooted: (v: boolean) => void;
  setAuthed: (v: boolean) => void;
  setState: (s: SystemState, label?: string) => void;
  setTranscript: (t: string, interim?: boolean) => void;
  setMic: (v: boolean) => void;
  setAmplitude: (v: number) => void;
  setError: (e: string | null) => void;
  togglePanel: (p: PanelId) => void;
  closePanel: (p: PanelId) => void;
  openPanel: (p: PanelId) => void;
  setSidebar: (v: boolean) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  resetAgents: () => void;
  log: (agent: string, message: string, level?: ActivityEntry["level"]) => void;
  pushDebug: (e: Omit<DebugEvent, "id" | "time">) => void;
  addMessage: (m: Omit<ChatMessage, "id" | "time">) => void;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  setWebhookUrl: (url: string) => void;
  setConnection: (c: ConnectionState) => void;
  setSound: (v: boolean) => void;
  setQuality: (q: JusprossState["quality"]) => void;
  setShortStage: (id: string, stage: Short["stage"]) => void;
  setReviewShort: (id: string | null) => void;
  addShort: (s: Short) => void;
}

export const useJuspross = create<JusprossState>((set, get) => ({
  booted: false,
  authed: false,
  systemState: "idle",
  statusLabel: "STANDBY",
  transcript: "",
  interim: false,
  micEnabled: false,
  wakeArmed: true,
  amplitude: 0,
  error: null,
  openPanels: [],
  sidebarOpen: true,
  agents: INITIAL_AGENTS,
  activity: [
    { id: "a1", time: Date.now(), agent: "NÚCLEO", message: "Sistema iniciado", level: "info" },
    { id: "a2", time: Date.now(), agent: "NÚCLEO", message: "Esperando activación", level: "info" },
    { id: "a3", time: Date.now(), agent: "SISTEMA", message: "Escuchando…", level: "info" },
    { id: "a4", time: Date.now(), agent: "NÚCLEO", message: "Listo para recibir orden", level: "done" },
  ],
  debug: [],
  shorts: INITIAL_SHORTS,
  reviewShortId: null,
  conversations: SEED_CONVERSATIONS,
  activeConversationId: SEED_CONVERSATIONS[0]!.id,
  webhookUrl: "",
  connection: "unknown",
  soundEnabled: true,
  quality: "high",

  setBooted: (v) => set({ booted: v }),
  setAuthed: (v) => set({ authed: v }),
  setState: (s, label) =>
    set({ systemState: s, statusLabel: label ?? s.toUpperCase() }),
  setTranscript: (t, interim = false) => set({ transcript: t, interim }),
  setMic: (v) => set({ micEnabled: v }),
  setAmplitude: (v) => set({ amplitude: v }),
  setError: (e) => set({ error: e }),
  togglePanel: (p) =>
    set((s) => ({
      openPanels: s.openPanels.includes(p)
        ? s.openPanels.filter((x) => x !== p)
        : [...s.openPanels, p],
    })),
  openPanel: (p) =>
    set((s) => ({ openPanels: s.openPanels.includes(p) ? s.openPanels : [...s.openPanels, p] })),
  closePanel: (p) => set((s) => ({ openPanels: s.openPanels.filter((x) => x !== p) })),
  setSidebar: (v) => set({ sidebarOpen: v }),
  updateAgent: (id, patch) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)),
    })),
  resetAgents: () =>
    set((s) => ({
      agents: s.agents.map((a) => ({ ...a, status: "IDLE", activity: "En espera", elapsedMs: 0 })),
    })),
  log: (agent, message, level = "info") =>
    set((s) => ({
      activity: [
        ...s.activity.slice(-120),
        { id: uid(), time: Date.now(), agent, message, level },
      ],
    })),
  pushDebug: (e) =>
    set((s) => ({ debug: [...s.debug.slice(-80), { ...e, id: uid(), time: Date.now() }] })),
  addMessage: (m) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === s.activeConversationId
          ? {
              ...c,
              updatedAt: Date.now(),
              title:
                c.messages.length === 0 && m.role === "user"
                  ? m.text.slice(0, 42)
                  : c.title,
              messages: [...c.messages, { ...m, id: uid(), time: Date.now() }],
            }
          : c,
      ),
    })),
  newConversation: () => {
    const c: Conversation = {
      id: uid(),
      title: "Nueva sesión",
      updatedAt: Date.now(),
      messages: [],
    };
    set((s) => ({ conversations: [c, ...s.conversations], activeConversationId: c.id }));
  },
  selectConversation: (id) => set({ activeConversationId: id }),
  setWebhookUrl: (url) => {
    set({ webhookUrl: url, connection: "unknown" });
    if (typeof window !== "undefined") localStorage.setItem("juspross.webhook", url);
  },
  setConnection: (c) => set({ connection: c }),
  setSound: (v) => set({ soundEnabled: v }),
  setQuality: (q) => set({ quality: q }),
  setShortStage: (id, stage) =>
    set((s) => ({ shorts: s.shorts.map((x) => (x.id === id ? { ...x, stage } : x)) })),
  setReviewShort: (id) => set({ reviewShortId: id }),
  addShort: (s0) => set((s) => ({ shorts: [s0, ...s.shorts] })),
}));

export const jp = () => useJuspross.getState();