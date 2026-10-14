import { useEffect, useRef } from "react";
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

  return <div ref={ref} className="absolute inset-0 cursor-grab bg-black active:cursor-grabbing" />;
}
