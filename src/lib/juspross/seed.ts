import type { Agent, Conversation, Short } from "./types";

export const INITIAL_AGENTS: Agent[] = [
  {
    id: "planificador",
    name: "PLANIFICADOR",
    role: "Descompone la intención en un plan ejecutable",
    status: "IDLE",
    activity: "En espera",
    updatedAt: 0,
    elapsedMs: 0,
    links: ["director"],
  },
  {
    id: "director",
    name: "DIRECTOR",
    role: "Orquesta el flujo y delega en los agentes",
    status: "IDLE",
    activity: "En espera",
    updatedAt: 0,
    elapsedMs: 0,
    links: ["investigador", "curador", "guionista"],
  },
  {
    id: "investigador",
    name: "INVESTIGADOR",
    role: "Recolecta y verifica fuentes",
    status: "IDLE",
    activity: "En espera",
    updatedAt: 0,
    elapsedMs: 0,
    links: ["director"],
  },
  {
    id: "curador",
    name: "CURADOR",
    role: "Filtra, prioriza y estructura el material",
    status: "IDLE",
    activity: "En espera",
    updatedAt: 0,
    elapsedMs: 0,
    links: ["director"],
  },
  {
    id: "guionista",
    name: "GUIONISTA",
    role: "Redacta el guion final del short",
    status: "IDLE",
    activity: "En espera",
    updatedAt: 0,
    elapsedMs: 0,
    links: ["director"],
  },
];

const now = Date.now();

export const INITIAL_SHORTS: Short[] = [
  {
    id: "s1",
    title: "El Taos Hum: el sonido que nadie puede grabar",
    stage: "REVISION",
    createdAt: now - 1000 * 60 * 42,
    durationSec: 48,
    hue: 205,
    views: 0,
  },
  {
    id: "s2",
    title: "Hormigas que explotan para salvar la colonia",
    stage: "PUBLICADO",
    createdAt: now - 1000 * 60 * 60 * 26,
    durationSec: 52,
    hue: 190,
    views: 184320,
    likes: 21044,
  },
  {
    id: "s3",
    title: "La biblioteca que se quemó dos veces",
    stage: "GUION",
    createdAt: now - 1000 * 60 * 60 * 5,
    durationSec: 44,
    hue: 228,
  },
  {
    id: "s4",
    title: "Relojes atómicos y el tiempo que se dobla",
    stage: "PUBLICADO",
    createdAt: now - 1000 * 60 * 60 * 72,
    durationSec: 57,
    hue: 215,
    views: 96410,
    likes: 8790,
  },
  {
    id: "s5",
    title: "Señal WOW: 72 segundos de silencio después",
    stage: "INVESTIGACION",
    createdAt: now - 1000 * 60 * 12,
    durationSec: 41,
    hue: 198,
  },
];

export const SEED_CONVERSATIONS: Conversation[] = [
  { id: "c1", title: "Sesión actual", updatedAt: now, messages: [] },
  {
    id: "c2",
    title: "Investigación sobre el Taos Hum",
    updatedAt: now - 1000 * 60 * 90,
    messages: [],
  },
  {
    id: "c3",
    title: "Short sobre hormigas explosivas",
    updatedAt: now - 1000 * 60 * 60 * 20,
    messages: [],
  },
  {
    id: "c4",
    title: "Análisis de tendencias",
    updatedAt: now - 1000 * 60 * 60 * 50,
    messages: [],
  },
];

export const ANALYTICS_SERIES = Array.from({ length: 28 }, (_, i) => ({
  day: i + 1,
  views: Math.round(12000 + Math.sin(i / 3) * 4200 + i * 780 + (i % 5) * 900),
  retention: Math.round(52 + Math.sin(i / 4) * 9 + (i % 3) * 2),
  ctr: +(6.2 + Math.sin(i / 5) * 1.4 + (i % 4) * 0.25).toFixed(2),
}));