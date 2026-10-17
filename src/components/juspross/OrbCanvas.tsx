import { useEffect, useRef } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { OrbScene } from "@/lib/juspross/scene/OrbScene";
import { useV2 } from "@/lib/juspross/v2Store";

/** Lienzo 3D del lado 2.0: fondo negro y núcleo orbitable con el cursor. */
export function OrbCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OrbScene | null>(null);
  const state = useV2((s) => s.state);
  const amplitude = useV2((s) => s.amplitude);

  useEffect(() => {
    if (!ref.current) return;
    const scene = new OrbScene(ref.current);
    sceneRef.current = scene;
    scene.setState(useV2.getState().state);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    sceneRef.current?.setAmplitude(amplitude);
  }, [amplitude]);

  return (
    <>
      <div ref={ref} className="absolute inset-0 cursor-grab bg-black active:cursor-grabbing" />
      {/* Los eventos de rueda no llegan de forma fiable a fondos web de Lively; los botones sí. */}
      <div className="pointer-events-none absolute bottom-28 right-5 z-40 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => sceneRef.current?.zoomIn()}
          aria-label="Acercar al núcleo"
          title="Acercar"
          className="pointer-events-auto flex size-9 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white/65 shadow-lg backdrop-blur-md transition-colors hover:border-[#6ea8ff]/60 hover:text-[#9cc0ff]"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => sceneRef.current?.zoomOut()}
          aria-label="Alejar del núcleo"
          title="Alejar"
          className="pointer-events-auto flex size-9 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white/65 shadow-lg backdrop-blur-md transition-colors hover:border-[#6ea8ff]/60 hover:text-[#9cc0ff]"
        >
          <ZoomOut className="size-4" />
        </button>
      </div>
    </>
  );
}
