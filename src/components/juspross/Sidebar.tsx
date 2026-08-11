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
  { id: "home", label: "HOME", Icon: Hexagon },
  { id: "agents", label: "AGENTS", Icon: BrainCircuit },
  { id: "shorts", label: "SHORTS", Icon: Film },
  { id: "analytics", label: "ANALYTICS", Icon: LineChart },
  { id: "activity", label: "ACTIVITY", Icon: Activity },
  { id: "connection", label: "CONNECTION", Icon: Radar },
  { id: "settings", label: "SETTINGS", Icon: Settings2 },
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
        "pointer-events-auto absolute top-1/2 left-4 z-40 -translate-y-1/2 transition-[width] duration-300",
        open ? "w-52" : "w-12",
      )}
    >
      <div className="holo rounded-md p-1.5">
        <button
          onClick={() => {
            setSidebar(!open);
            cue("interact", sound);
          }}
          aria-label={open ? "Cerrar navegación" : "Abrir navegación"}
          className="mb-1 flex h-9 w-full items-center gap-3 rounded-sm px-2.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-cyan"
        >
          {open ? (
            <ChevronsLeft className="size-4 shrink-0" />
          ) : (
            <PanelsTopLeft className="size-4 shrink-0" />
          )}
          {open && <span className="label-xs">NAVEGACIÓN</span>}
        </button>
        <div className="hairline mb-1 h-px w-full" />
        {NAV.map(({ id, label, Icon }) => {
          const active = id !== "home" && openPanels.includes(id as PanelId);
          return (
            <button
              key={id}
              onClick={() => {
                cue("interact", sound);
                if (id === "home") useJuspross.setState({ openPanels: [] });
                else togglePanel(id as PanelId);
              }}
              className={cn(
                "group relative flex h-9 w-full items-center gap-3 rounded-sm px-2.5 transition-colors",
                active
                  ? "bg-primary/12 text-cyan"
                  : "text-muted-foreground hover:bg-primary/8 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.5} />
              {open && (
                <span className="font-mono text-[10px] tracking-[0.2em]">{label}</span>
              )}
              {active && (
                <span className="absolute top-1/2 right-1.5 size-1 -translate-y-1/2 rounded-full bg-cyan shadow-[0_0_8px_var(--cyan)]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}