import { useEffect, useRef } from "react";
import { MediaScene } from "@/lib/juspross/scene/MediaScene";
import { useMedia } from "@/lib/juspross/mediaStore";
import { MediaConsole } from "./MediaConsole";
import { MediaHistory } from "./MediaHistory";
import { MediaWindows } from "./MediaWindows";

/** Lado IMA/VID: agua dorada y bola de agua (se anima al crear), chat, ventanas e historial. */
export function MediaCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MediaScene | null>(null);
  const hydrate = useMedia((s) => s.hydrate);
  const busy = useMedia((s) => s.busy);
  const progress = useMedia((s) => s.progress);
  const burst = useMedia((s) => s.burstTick);

  useEffect(() => hydrate(), [hydrate]);

  useEffect(() => {
    if (!ref.current) return;
    const scene = new MediaScene(ref.current);
    sceneRef.current = scene;
    const st = useMedia.getState();
    scene.setWork(st.busy);
    scene.setProgress(st.progress);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setWork(busy);
  }, [busy]);
  useEffect(() => {
    sceneRef.current?.setProgress(progress);
  }, [progress]);
  useEffect(() => {
    if (burst > 0) sceneRef.current?.burst();
  }, [burst]);

  return (
    <>
      <div ref={ref} className="absolute inset-0 cursor-grab bg-black active:cursor-grabbing" />
      <MediaConsole />
      <MediaWindows />
      <MediaHistory />
    </>
  );
}
