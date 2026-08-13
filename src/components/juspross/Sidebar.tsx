import {
  Activity,
  BrainCircuit,
  Bug,
  ChevronsLeft,
  Hexagon,
  LineChart,
  PanelsTopLeft,
  Radar,
  Settings2,
  Film,
} from "lucide-react";
import { useJuspross } from "@/lib/juspross/store";
import type { PanelId } from "@/lib/juspross/types";
import { cn } from "@/lib/utils";
import { cue } from "@/lib/juspross/audio";

const NAV: { id: PanelId | "home"; label: string; Icon: typeof Hexagon }[] = [
  { id: "home", label: "INICIO", Icon: Home },
  { id: "agents", label: "AGENTES", Icon: BrainCircuit },
  { id: "shorts", label: "SHORTS", Icon: PlusSquare },
  { id: "analytics", label: "ANALYTICS", Icon: LineChart },
  { id: "activity", label: "ACTIVIDAD", Icon: Radar },
  { id: "history", label: "MEMORIA", Icon: Grid2x2 },
  { id: "settings", label: "CONFIG", Icon: Settings2 },
  { id: "debug", label: "DEBUG", Icon: Bug },
];

export function Sidebar() {
  const open = useJuspross((s) => s.sidebarOpen);
  const setSidebar = useJuspross((s) => s.setSidebar);
  const openPanels = useJuspross((s) => s.openPanels);
  const togglePanel = useJuspross((s) => s.togglePanel);
  const sound = useJuspross((s) => s.soundEnabled);

  return (
    <nav
      className={cn(
        "pointer-events-auto absolute top-1/2 left-0 z-40 -translate-y-1/2 transition-[width] duration-300",
        open ? "w-[168px]" : "w-14",
      )}
    >
      <div className="holo rounded-r-lg border-l-0 py-3 pr-2 pl-2">
        {NAV.map(({ id, label, Icon }) => {
          const active = id !== "home" && openPanels.includes(id as PanelId);
          const homeActive = id === "home" && openPanels.length === 0;
          return (
            <button
              key={id}
              onClick={() => {
                cue("interact", sound);
                if (id === "home") useJuspross.setState({ openPanels: [] });
                else togglePanel(id as PanelId);
              }}
              className={cn(
                "group relative mb-1 flex h-11 w-full items-center gap-3 rounded-md px-2.5 transition-colors",
                active || homeActive
                  ? "bg-cyan/12 text-cyan shadow-[inset_0_0_0_1px_var(--glass-edge)]"
                  : "text-muted-foreground hover:bg-primary/10 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  active || homeActive ? "bg-cyan/15 text-cyan" : "",
                )}
              >
                <Icon className="size-4" strokeWidth={1.5} />
              </span>
              {open && (
                <span className="font-mono text-[10px] tracking-[0.22em]">{label}</span>
              )}
            </button>
          );
        })}
        <div className="hairline my-2 h-px w-full" />
        <button
          onClick={() => {
            setSidebar(!open);
            cue("interact", sound);
          }}
          aria-label={open ? "Cerrar navegación" : "Abrir navegación"}
          className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-cyan"
        >
          <ChevronsLeft
            className={cn("size-4 shrink-0 transition-transform", !open && "rotate-180")}
          />
          {open && <span className="font-mono text-[10px] tracking-[0.22em]">CERRAR</span>}
        </button>
      </div>
    </nav>
  );
}