import type { ComponentType } from "react";
import { useJuspross } from "@/lib/juspross/store";
import type { PanelId } from "@/lib/juspross/types";
import { HoloWindow } from "./HoloWindow";
import { AgentsPanel } from "./panels/AgentsPanel";
import { ActivityPanel } from "./panels/ActivityPanel";
import { ShortsPanel } from "./panels/ShortsPanel";
import { AnalyticsPanel } from "./panels/AnalyticsPanel";
import { DebugPanel } from "./panels/DebugPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import { ConnectionPanel, SettingsPanel } from "./panels/SettingsPanel";

const META: Record<
  PanelId,
  { title: string; subtitle: string; x: number; y: number; w: number; Body: ComponentType }
> = {
  agents: { title: "AGENTES", subtitle: "RED NEURONAL OPERATIVA", x: 96, y: 96, w: 380, Body: AgentsPanel },
  activity: { title: "ACTIVIDAD", subtitle: "FLUJO EN VIVO", x: 96, y: 420, w: 420, Body: ActivityPanel },
  shorts: { title: "SHORTS", subtitle: "PIPELINE DE PRODUCCIÓN", x: 640, y: 96, w: 400, Body: ShortsPanel },
  analytics: { title: "ANALYTICS", subtitle: "RENDIMIENTO 28 DÍAS", x: 700, y: 380, w: 400, Body: AnalyticsPanel },
  settings: { title: "AJUSTES", subtitle: "PREFERENCIAS DEL SISTEMA", x: 420, y: 200, w: 340, Body: SettingsPanel },
  debug: { title: "DEBUG", subtitle: "TRÁFICO N8N", x: 380, y: 300, w: 440, Body: DebugPanel },
  connection: { title: "CONEXIÓN", subtitle: "ENLACE CON N8N", x: 440, y: 150, w: 360, Body: ConnectionPanel },
  history: { title: "SESIONES", subtitle: "MEMORIA CONVERSACIONAL", x: 140, y: 150, w: 320, Body: HistoryPanel },
};

export function PanelHost() {
  const openPanels = useJuspross((s) => s.openPanels);
  const closePanel = useJuspross((s) => s.closePanel);

  return (
    <>
      {openPanels.map((id) => {
        const m = META[id];
        const Body = m.Body;
        return (
          <HoloWindow
            key={id}
            title={m.title}
            subtitle={m.subtitle}
            width={m.w}
            initial={{ x: m.x, y: m.y }}
            onClose={() => closePanel(id)}
          >
            <Body />
          </HoloWindow>
        );
      })}
    </>
  );
}