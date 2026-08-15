import { createFileRoute } from "@tanstack/react-router";
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
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-background">
      <CoreCanvas />
      <div className="pointer-events-none absolute inset-0">
        <Brand />
        <Sidebar />
        <StatusDeck />
        <Telemetry />
        <PanelHost />
        <CommandBar />
      </div>
      <BootSequence />
    </main>
  );
}
