import { useEffect, useRef } from "react";
import { MediaScene } from "@/lib/juspross/scene/MediaScene";

/** Lado IMA/VID: selva con riachuelo y una bola de agua. Arrastra para mirar, rueda para acercar. */
export function MediaCanvas() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const scene = new MediaScene(ref.current);
    return () => scene.dispose();
  }, []);

  return (
    <>
      <div ref={ref} className="absolute inset-0 cursor-grab bg-black active:cursor-grabbing" />
      <p className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2 font-mono text-[9px] tracking-[0.25em] text-white/35">
        ARRASTRA PARA MIRAR · RUEDA PARA ACERCAR
      </p>
    </>
  );
}
