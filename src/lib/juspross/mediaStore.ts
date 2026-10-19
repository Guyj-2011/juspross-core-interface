import { create } from "zustand";
import {
  AgnesError,
  FREE_MODELS,
  IMAGE_PRESETS,
  VIDEO_DURATIONS,
  VIDEO_PRESETS,
  createVideo,
  downloadBlob,
  generateImage,
  pingAgnes,
  polishPrompt,
  pollVideo,
  sleep,
  videoCooldownMs,
  waitImageSlot,
  type MediaKind,
} from "./agnes";
import { clearBlobs, delBlob, putBlob } from "./mediaDb";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  prompt: string;
  finalPrompt: string;
  model: string;
  size: string;
  seconds?: number;
  createdAt: number;
  mime: string;
  hasBlob: boolean;
  remoteUrl?: string;
}
export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  itemId?: string;
  error?: boolean;
  pending?: boolean;
  finalPrompt?: string;
}
export interface MediaWin {
  id: string;
  itemId: string;
  x: number;
  y: number;
}
type Link = "none" | "checking" | "ok" | "invalid" | "error";

const K_SET = "juspross.media";
const K_ITEMS = "juspross.media.items";
const K_CHAT = "juspross.media.chat";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* almacenamiento lleno o no disponible */
  }
};
const load = <T>(k: string): T | null => {
  try {
    const r = localStorage.getItem(k);
    return r ? (JSON.parse(r) as T) : null;
  } catch {
    return null;
  }
};

interface MediaStore {
  key: string;
  link: Link;
  linkDetail: string;
  kind: MediaKind;
  imagePreset: string;
  videoPreset: string;
  duration: string;
  polish: boolean;
  messages: ChatMsg[];
  items: MediaItem[];
  windows: MediaWin[];
  busy: boolean;
  progress: number;
  workLabel: string;
  burstTick: number;
  historyOpen: boolean;
  settingsOpen: boolean;

  hydrate: () => void;
  setOpt: (
    p: Partial<Pick<MediaStore, "kind" | "imagePreset" | "videoPreset" | "duration" | "polish">>,
  ) => void;
  setHistoryOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  connect: (key: string) => Promise<void>;
  disconnect: () => void;
  openWin: (itemId: string) => void;
  closeWin: (id: string) => void;
  moveWin: (id: string, x: number, y: number) => void;
  focusWin: (id: string) => void;
  deleteItem: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  clearChat: () => void;
  cancel: () => void;
  create: (text: string) => Promise<void>;
}

let ctrl: AbortController | null = null;

function persistSettings(s: MediaStore) {
  save(K_SET, {
    key: s.key,
    kind: s.kind,
    imagePreset: s.imagePreset,
    videoPreset: s.videoPreset,
    duration: s.duration,
    polish: s.polish,
  });
}

export const useMedia = create<MediaStore>((set, get) => ({
  key: "",
  link: "none",
  linkDetail: "",
  kind: "image",
  imagePreset: "square",
  videoPreset: "wide",
  duration: "5",
  polish: true,
  messages: [],
  items: [],
  windows: [],
  busy: false,
  progress: 0,
  workLabel: "",
  burstTick: 0,
  historyOpen: false,
  settingsOpen: false,

  hydrate: () => {
    const st = load<Partial<MediaStore>>(K_SET);
    const items = load<MediaItem[]>(K_ITEMS) ?? [];
    const msgs = (load<ChatMsg[]>(K_CHAT) ?? []).map((m) => ({ ...m, pending: false }));
    set({
      key: st?.key ?? "",
      link: st?.key ? "ok" : "none",
      linkDetail: st?.key ? "Clave guardada en este navegador." : "",
      kind: st?.kind === "video" ? "video" : "image",
      imagePreset: st?.imagePreset ?? "square",
      videoPreset: st?.videoPreset ?? "wide",
      duration: st?.duration ?? "5",
      polish: st?.polish ?? true,
      items,
      messages: msgs,
    });
  },
  setOpt: (p) => {
    set(p);
    persistSettings(get());
  },
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  connect: async (raw) => {
    const key = raw.trim();
    if (key.length < 8 || /\s/.test(key)) {
      set({ link: "error", linkDetail: "La clave parece incompleta." });
      return;
    }
    set({ link: "checking", linkDetail: "Probando la clave…" });
    try {
      const r = await pingAgnes(key);
      let detail = "Conectado con Agnes.";
      if (r.limited) {
        detail =
          "Clave guardada. Agnes está limitando el ritmo ahora mismo, así que no pude verificarla del todo; espera un minuto y prueba a crear algo.";
      } else if (r.models.length) {
        const missing = (["image", "video", "text"] as const).filter(
          (k) => !r.models.includes(FREE_MODELS[k]),
        );
        if (missing.length) {
          detail = `Conectado, pero tu cuenta no lista: ${missing.map((k) => FREE_MODELS[k]).join(", ")}.`;
        }
      }
      set({ key, link: "ok", linkDetail: detail });
      persistSettings(get());
    } catch (e) {
      const status = e instanceof AgnesError ? e.status : 0;
      set({
        link: status === 401 ? "invalid" : "error",
        linkDetail: e instanceof Error ? e.message : "No se pudo conectar.",
      });
    }
  },
  disconnect: () => {
    set({ key: "", link: "none", linkDetail: "Clave eliminada de este navegador." });
    persistSettings(get());
  },

  openWin: (itemId) => {
    const { windows } = get();
    const open = windows.find((w) => w.itemId === itemId);
    if (open) return get().focusWin(open.id);
    const n = windows.length % 6;
    const w = typeof window === "undefined" ? 1200 : window.innerWidth;
    set({
      windows: [
        ...windows,
        { id: uid(), itemId, x: Math.max(16, w / 2 - 300 + n * 34), y: 84 + n * 30 },
      ],
    });
  },
  closeWin: (id) => set((s) => ({ windows: s.windows.filter((w) => w.id !== id) })),
  moveWin: (id, x, y) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, x, y } : w)) })),
  focusWin: (id) =>
    set((s) => {
      const w = s.windows.find((x) => x.id === id);
      return w ? { windows: [...s.windows.filter((x) => x.id !== id), w] } : {};
    }),

  deleteItem: async (id) => {
    await delBlob(id).catch(() => undefined);
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      windows: s.windows.filter((w) => w.itemId !== id),
      messages: s.messages.map((m) => (m.itemId === id ? { ...m, itemId: "" } : m)),
    }));
    save(K_ITEMS, get().items);
  },
  clearAll: async () => {
    await clearBlobs().catch(() => undefined);
    set({ items: [], windows: [] });
    save(K_ITEMS, []);
  },
  clearChat: () => {
    set({ messages: [] });
    save(K_CHAT, []);
  },
  cancel: () => ctrl?.abort(),

  create: async (raw) => {
    const st = get();
    const text = raw.trim();
    if (!text || st.busy) return;
    if (!st.key) {
      set({ settingsOpen: true });
      return;
    }
    const key = st.key;
    const kind = st.kind;
    ctrl = new AbortController();
    const signal = ctrl.signal;
    const pendId = uid();
    const history = st.messages
      .filter((m) => !m.error && m.finalPrompt)
      .slice(-3)
      .flatMap((m, i, arr) => {
        const userBefore = st.messages[st.messages.indexOf(m) - 1];
        return userBefore?.role === "user" && i < arr.length
          ? [
              { role: "user" as const, content: userBefore.text },
              { role: "assistant" as const, content: m.finalPrompt as string },
            ]
          : [];
      });
    set((s) => ({
      busy: true,
      progress: 0.03,
      workLabel: "Pensando…",
      messages: [
        ...s.messages.slice(-60),
        { id: uid(), role: "user", text },
        {
          id: pendId,
          role: "assistant",
          text: kind === "image" ? "Preparando la imagen…" : "Preparando el video…",
          pending: true,
        },
      ],
    }));
    const patch = (p: Partial<ChatMsg>) =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === pendId ? { ...m, ...p } : m)) }));
    let timer: ReturnType<typeof setInterval> | undefined;
    const ramp = (from: number, to: number, secs: number) => {
      const t0 = Date.now();
      timer = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / 1000 / secs);
        set({ progress: from + (to - from) * (1 - Math.pow(1 - k, 2)) });
      }, 400);
    };

    try {
      let finalPrompt = text;
      if (st.polish) {
        try {
          finalPrompt = (await polishPrompt(key, kind, history, text, signal)) || text;
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e; // si falla la mejora, se usa tu texto tal cual
        }
      }
      const created = Date.now();
      let item: MediaItem;
      if (kind === "image") {
        const preset = IMAGE_PRESETS.find((p) => p.id === st.imagePreset) ?? IMAGE_PRESETS[0];
        patch({ text: "Creando la imagen…", finalPrompt });
        set({ workLabel: "Creando imagen", progress: 0.08 });
        await waitImageSlot(signal);
        ramp(0.08, 0.93, 28);
        const { blob, remoteUrl } = await generateImage(key, finalPrompt, preset.size, signal);
        const id = uid();
        await putBlob(id, blob).catch(() => undefined);
        item = {
          id,
          kind,
          prompt: text,
          finalPrompt,
          model: FREE_MODELS.image,
          size: preset.size,
          createdAt: created,
          mime: blob.type || "image/png",
          hasBlob: true,
          ...(remoteUrl ? { remoteUrl } : {}),
        };
      } else {
        const preset = VIDEO_PRESETS.find((p) => p.id === st.videoPreset) ?? VIDEO_PRESETS[0];
        const dur = VIDEO_DURATIONS.find((d) => d.id === st.duration) ?? VIDEO_DURATIONS[1];
        patch({ text: "Preparando el video…", finalPrompt });
        for (let wait = videoCooldownMs(); wait > 0; wait = videoCooldownMs()) {
          const s = Math.ceil(wait / 1000);
          patch({ text: `El plan gratis permite 1 video por minuto. Espero ${s} s…` });
          set({ workLabel: `Esperando ${s} s`, progress: 0.04 });
          await sleep(1000, signal);
        }
        set({ workLabel: "Creando video", progress: 0.08 });
        const videoId = await createVideo(key, finalPrompt, preset, dur.frames, signal);
        patch({ text: "El video está en cola. Puede tardar unos minutos…" });
        ramp(0.08, 0.94, 170);
        const url = await pollVideo(
          key,
          videoId,
          (sec, status) =>
            patch({ text: `Creando el video… ${sec} s${status ? ` · ${status}` : ""}` }),
          signal,
        );
        set({ workLabel: "Descargando", progress: 0.97 });
        const blob = await downloadBlob(url, signal).catch(() => null);
        const id = uid();
        if (blob) await putBlob(id, blob).catch(() => undefined);
        item = {
          id,
          kind,
          prompt: text,
          finalPrompt,
          model: FREE_MODELS.video,
          size: `${preset.w}x${preset.h}`,
          seconds: dur.seconds,
          createdAt: created,
          mime: blob?.type || "video/mp4",
          hasBlob: !!blob,
          remoteUrl: url,
        };
      }
      set((s) => ({ items: [item, ...s.items], burstTick: s.burstTick + 1 }));
      save(K_ITEMS, get().items);
      patch({
        pending: false,
        text: kind === "image" ? "Lista tu imagen." : "Listo tu video.",
        itemId: item.id,
      });
      get().openWin(item.id);
    } catch (e) {
      if ((e as Error).name === "AbortError")
        patch({ pending: false, error: true, text: "Cancelado." });
      else
        patch({
          pending: false,
          error: true,
          text: e instanceof AgnesError || e instanceof Error ? e.message : "No se pudo crear.",
        });
    } finally {
      if (timer) clearInterval(timer);
      set({ busy: false, progress: 0, workLabel: "" });
      save(K_CHAT, get().messages.slice(-40));
      ctrl = null;
    }
  },
}));
