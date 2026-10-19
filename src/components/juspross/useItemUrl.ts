import { useEffect, useState } from "react";
import { getBlob } from "@/lib/juspross/mediaDb";
import type { MediaItem } from "@/lib/juspross/mediaStore";

/** Dirección para mostrar un resultado: el archivo guardado en el navegador o, si no hay, el enlace remoto. */
export function useItemUrl(item: MediaItem | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const id = item?.id;
  const hasBlob = item?.hasBlob;
  const remote = item?.remoteUrl;

  useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    setUrl(null);
    if (!id) return;
    void (async () => {
      if (hasBlob) {
        const b = await getBlob(id).catch(() => null);
        if (b && alive) {
          obj = URL.createObjectURL(b);
          setUrl(obj);
          return;
        }
      }
      if (alive) setUrl(remote ?? null);
    })();
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [id, hasBlob, remote]);

  return url;
}
