import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { OrbCanvas } from "@/components/juspross/OrbCanvas";
import { V2Console } from "@/components/juspross/V2Console";
import { ModeSwitch } from "@/components/juspross/ModeSwitch";
import { useV2 } from "@/lib/juspross/v2Store";
import { cn } from "@/lib/utils";
import { CoreCanvas } from "@/components/juspross/CoreCanvas";
import { Brand } from "@/components/juspross/Brand";
import { Sidebar } from "@/components/juspross/Sidebar";
import { StatusDeck, Telemetry } from "@/components/juspross/StatusDeck";
import { CommandBar } from "@/components/juspross/CommandBar";
import { PanelHost } from "@/components/juspross/PanelHost";
import { BootSequence } from "@/components/juspross/BootSequence";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Juspross — Sistema operativo de inteligencia artificial" },
      {
        name: "description",
        content:
          "Juspross: núcleo de IA con voz, agentes autónomos y producción de shorts en un entorno holográfico 3D.",
      },
      { property: "og:title", content: "Juspross — Sistema operativo de IA" },
      {
        property: "og:description",
        content: "Núcleo vivo de partículas, agentes autónomos y control por voz en tiempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const mode = useV2((s) => s.mode);
  const hydrate = useV2((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);

  return (
    <main
      className={cn(
        "relative h-screen w-screen overflow-hidden",
        mode === "v2" ? "bg-black" : "bg-background",
      )}
    >
      {mode === "calm" ? (
        <>
          <CoreCanvas />
          <div className="pointer-events-none absolute inset-0">
            <Brand />
            <Sidebar />
            <StatusDeck />
            <Telemetry />
            <PanelHost />
            <CommandBar />
          </div>
        </>
      ) : (
        <>
          <OrbCanvas />
          <V2Console />
        </>
      )}
      <ModeSwitch />
      <BootSequence />
    </main>
  );
}
