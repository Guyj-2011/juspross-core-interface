import { useEffect, useState, type ComponentType } from "react";
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
  { title: string; subtitle: string; w: number; accent: string; accent2: string; Body: ComponentType }
> = {
  agents: {
    title: "AGENTES",
    subtitle: "RED NEURONAL OPERATIVA",
    w: 380,
    accent: "var(--cyan)",
    accent2: "var(--electric)",
    Body: AgentsPanel,
  },
  activity: {
    title: "ACTIVIDAD",
    subtitle: "FLUJO EN VIVO",
    w: 400,
    accent: "var(--emerald)",
    accent2: "var(--cyan)",
    Body: ActivityPanel,
  },
  shorts: {
    title: "SHORTS",
    subtitle: "PIPELINE DE PRODUCCIÓN",
    w: 400,
    accent: "var(--magenta)",
    accent2: "var(--violet)",
    Body: ShortsPanel,
  },
  analytics: {
    title: "ANALYTICS",
    subtitle: "RENDIMIENTO 28 DÍAS",
    w: 400,
    accent: "var(--violet)",
    accent2: "var(--electric)",
    Body: AnalyticsPanel,
  },
  settings: {
    title: "AJUSTES",
    subtitle: "PREFERENCIAS DEL SISTEMA",
    w: 340,
    accent: "var(--electric)",
    accent2: "var(--cyan)",
    Body: SettingsPanel,
  },
  debug: {
    title: "DEBUG",
    subtitle: "TRÁFICO N8N",
    w: 420,
    accent: "var(--amber)",
    accent2: "var(--magenta)",
    Body: DebugPanel,
  },
  connection: {
    title: "CONEXIÓN",
    subtitle: "ENLACE CON N8N",
    w: 360,
    accent: "var(--emerald)",
    accent2: "var(--electric)",
    Body: ConnectionPanel,
  },
  history: {
    title: "SESIONES",
    subtitle: "MEMORIA CONVERSACIONAL",
    w: 330,
    accent: "var(--cyan)",
    accent2: "var(--magenta)",
    Body: HistoryPanel,
  },
};

const GAP = 18;
const TOP = 92;
const LEFT = 112;
const ROW_H = 336;

/** Reparte los paneles abiertos en una rejilla ordenada (columnas → filas). */
function useTiles(ids: PanelId[]) {
  const [vp, setVp] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const set = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

  const rows = Math.max(1, Math.floor((vp.h - TOP - 150) / ROW_H));
  const positions: Record<string, { x: number; y: number }> = {};
  let x = LEFT;
  let row = 0;
  let colW = 0;
  let wrap = 0;
  ids.forEach((id) => {
    const w = META[id].w;
    if (row >= rows) {
      x += colW + GAP;
      row = 0;
      colW = 0;
    }
    // si la columna ya no cabe en pantalla, se reinicia con un ligero desfase
    if (x + w > vp.w - 24) {
      wrap += 1;
      x = LEFT + wrap * 26;
      row = 0;
      colW = 0;
    }
    colW = Math.max(colW, w);
    positions[id] = { x, y: TOP + wrap * 18 + row * ROW_H };
    row += 1;
  });
  return positions;
}

export function PanelHost() {
  const openPanels = useJuspross((s) => s.openPanels);
  const closePanel = useJuspross((s) => s.closePanel);
  const tiles = useTiles(openPanels);

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
            accent={m.accent}
            accent2={m.accent2}
            position={tiles[id] ?? { x: LEFT, y: TOP }}
            maxBodyHeight={ROW_H - 74}
            onClose={() => closePanel(id)}
          >
            <Body />
          </HoloWindow>
        );
      })}
    </>
  );
}
