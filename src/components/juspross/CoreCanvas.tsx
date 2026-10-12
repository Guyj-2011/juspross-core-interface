import { useEffect, useRef } from "react";
import logoAsset from "@/assets/juspross-logo.png.asset.json";
import { JusprossScene, loadLogo, type Quality } from "@/lib/juspross/scene/JusprossScene";
import { useJuspross } from "@/lib/juspross/store";

export function CoreCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<JusprossScene | null>(null);
  const quality = useJuspross((s) => s.quality);
  const systemState = useJuspross((s) => s.systemState);
  const amplitude = useJuspross((s) => s.amplitude);
  const auroraStyle = useJuspross((s) => s.auroraStyle);

  useEffect(() => {
    let alive = true;
    const el = ref.current;
    if (!el) return;
    void loadLogo(logoAsset.url).then((img) => {
      if (!alive || !ref.current) return;
      sceneRef.current = new JusprossScene(ref.current, img, quality as Quality);
      sceneRef.current.setState(useJuspross.getState().systemState);
      sceneRef.current.setAuroraStyle(useJuspross.getState().auroraStyle);
    });
    return () => {
      alive = false;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [quality]);

  useEffect(() => {
    sceneRef.current?.setState(systemState);
  }, [systemState]);

  useEffect(() => {
    sceneRef.current?.setAmplitude(amplitude);
  }, [amplitude]);

  useEffect(() => {
    sceneRef.current?.setAuroraStyle(auroraStyle);
  }, [auroraStyle]);

  return <div ref={ref} className="absolute inset-0" aria-hidden />;
}