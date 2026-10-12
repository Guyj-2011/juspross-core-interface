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

const GAP = 16;
const TOP = 92;
const BOTTOM = 170; // espacio reservado para la barra de comandos
const RIGHT = 24;
const MIN_W = 280; // ancho mínimo útil de un panel
const IDEAL_H = 360; // alto máximo de un panel cuando hay espacio
const MIN_H = 150;
const CHROME = 44; // cabecera + bordes del panel (el resto es cuerpo con scroll)

interface Tile {
  x: number;
  y: number;
  w: number;
  bodyH: number;
}

/**
 * Reparte los paneles abiertos en una rejilla que SIEMPRE cabe en pantalla:
 * prueba distintas combinaciones de columnas/filas y elige la que deja los
 * paneles más grandes. Si falta espacio, los paneles se encogen (el contenido
 * hace scroll) en lugar de apilarse unos sobre otros.
 */
function useTiles(ids: PanelId[], left: number): Record<string, Tile> {
  const [vp, setVp] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const set = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

  const n = ids.length;
  if (n === 0) return {};

  const W = Math.max(MIN_W, vp.w - left - RIGHT);
  const H = Math.max(MIN_H, vp.h - TOP - BOTTOM);

  type Plan = {
    rows: number;
    colW: number[];
    cellH: number;
    score: number;
    empty: number;
    valid: boolean;
  };
  const plans: Plan[] = [];

  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    if (Math.ceil(n / rows) !== cols) continue; // combinación repetida

    // ancho natural de cada columna = el mayor de sus paneles
    const nat: number[] = Array.from({ length: cols }, () => 0);
    ids.forEach((id, i) => {
      const c = Math.floor(i / rows);
      nat[c] = Math.max(nat[c] ?? 0, META[id].w);
    });
    const sum = nat.reduce((a, b) => a + b, 0);
    const f = Math.min(1, (W - GAP * (cols - 1)) / sum);
    const colW = nat.map((w) => Math.floor(w * f));

    const fitH = Math.floor((H - GAP * (rows - 1)) / rows);
    const cellH = Math.max(MIN_H, Math.min(IDEAL_H, fitH));
    const valid = Math.min(...colW) >= MIN_W && fitH >= MIN_H;

    plans.push({
      rows,
      colW,
      cellH,
      score: Math.round(f * (cellH / IDEAL_H) * 100),
      empty: cols * rows - n,
      valid,
    });
  }

  plans.sort(
    (a, b) => Number(b.valid) - Number(a.valid) || b.score - a.score || a.empty - b.empty
  );
  const best = plans[0]!;

  const xs: number[] = [];
  let x = left;
  best.colW.forEach((w, c) => {
    xs[c] = x;
    x += w + GAP;
  });

  const tiles: Record<string, Tile> = {};
  ids.forEach((id, i) => {
    const c = Math.floor(i / best.rows);
    const r = i % best.rows;
    tiles[id] = {
      x: xs[c] ?? left,
      y: TOP + r * (best.cellH + GAP),
      w: best.colW[c] ?? META[id].w,
      bodyH: best.cellH - CHROME,
    };
  });
  return tiles;
}

export function PanelHost() {
  const openPanels = useJuspross((s) => s.openPanels);
  const closePanel = useJuspross((s) => s.closePanel);
  const sidebarOpen = useJuspross((s) => s.sidebarOpen);
  const tiles = useTiles(openPanels, sidebarOpen ? 186 : 76);

  return (
    <>
      {openPanels.map((id) => {
        const m = META[id];
        const Body = m.Body;
        const t = tiles[id];
        return (
          <HoloWindow
            key={id}
            title={m.title}
            subtitle={m.subtitle}
            width={t?.w ?? m.w}
            accent={m.accent}
            accent2={m.accent2}
            position={{ x: t?.x ?? 186, y: t?.y ?? TOP }}
            maxBodyHeight={t?.bodyH ?? IDEAL_H - CHROME}
            onClose={() => closePanel(id)}
          >
            <Body />
          </HoloWindow>
        );
      })}
    </>
  );
}
