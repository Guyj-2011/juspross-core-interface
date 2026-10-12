export type AuroraStyle = "canopy" | "distributed" | "depth";

export type SystemState =
  | "idle"
  | "listening"
  | "thinking"
  | "processing"
  | "speaking"
  | "success"
  | "error";

export type AgentStatus = "IDLE" | "ACTIVE" | "PROCESSING" | "COMPLETED" | "ERROR";

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  activity: string;
  updatedAt: number;
  elapsedMs: number;
  /** ids of agents this one feeds into */
  links: string[];
}

export interface ActivityEntry {
  id: string;
  time: number;
  agent: string;
  message: string;
  level: "info" | "warn" | "error" | "done";
}

export interface ChatMessage {
  id: string;
  role: "user" | "juspross";
  text: string;
  time: number;
  channel: "voice" | "text";
  files?: { name: string; size: number; kind: string }[];
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export type ShortStage =
  | "IDEA"
  | "INVESTIGACION"
  | "CURACION"
  | "GUION"
  | "PRODUCCION"
  | "REVISION"
  | "APROBACION"
  | "PUBLICADO";

export interface Short {
  id: string;
  title: string;
  stage: ShortStage;
  createdAt: number;
  durationSec: number;
  hue: number;
  views?: number;
  likes?: number;
}

export interface DebugEvent {
  id: string;
  time: number;
  direction: "out" | "in";
  label: string;
  payload: unknown;
  ms?: number;
  ok?: boolean;
}

export type PanelId =
  | "agents"
  | "activity"
  | "shorts"
  | "analytics"
  | "settings"
  | "debug"
  | "connection"
  | "history";

export type ConnectionState = "unknown" | "checking" | "online" | "offline";