import { useRef, useState } from "react";
import { Copy, Download, Film, Image as ImageIcon, X } from "lucide-react";
import { useMedia, type MediaItem, type MediaWin } from "@/lib/juspross/mediaStore";
import { useItemUrl } from "./useItemUrl";

const fmtDate = (t: number) =>
  new Date(t).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Ventanas flotantes con las imágenes y videos creados. */
export function MediaWindows() {
  const windows = useMedia((s) => s.windows);
  const items = useMedia((s) => s.items);
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {windows.map((w, i) => {
        const item = items.find((x) => x.id === w.itemId);
        return item ? <MediaWindow key={w.id} win={w} item={item} z={i} /> : null;
      })}
    </div>
  );
}

function MediaWindow({ win, item, z }: { win: MediaWin; item: MediaItem; z: number }) {
  const url = useItemUrl(item);
  const moveWin = useMedia((s) => s.moveWin);
  const focusWin = useMedia((s) => s.focusWin);
  const closeWin = useMedia((s) => s.closeWin);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const isVideo = item.kind === "video";
  const ext = isVideo
    ? "mp4"
    : item.mime.includes("jpeg")
      ? "jpg"
      : item.mime.includes("webp")
        ? "webp"
        : "png";
  const media = "max-h-[62vh] max-w-[min(86vw,760px)] rounded-md bg-black object-contain";

  return (
    <div
      className="pointer-events-auto absolute rounded-xl border border-[#ffc83a]/30 bg-black/90 shadow-[0_0_50px_-14px_#ffb800] backdrop-blur-xl"
      style={{ left: win.x, top: win.y, zIndex: z }}
      onPointerDown={() => focusWin(win.id)}
    >
      <div
        className="flex cursor-grab items-center gap-2 border-b border-white/10 px-3 py-2 active:cursor-grabbing"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button,a")) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          moveWin(
            win.id,
            Math.min(window.innerWidth - 80, Math.max(-200, e.clientX - drag.current.dx)),
            Math.min(window.innerHeight - 50, Math.max(0, e.clientY - drag.current.dy)),
          );
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {isVideo ? (
          <Film className="size-3.5 text-[#ffd36b]" />
        ) : (
          <ImageIcon className="size-3.5 text-[#ffd36b]" />
        )}
        <span className="font-mono text-[10px] tracking-[0.22em] text-[#ffd36b]">
          {isVideo ? "VIDEO" : "IMAGEN"} · {fmtDate(item.createdAt).toUpperCase()}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {url && (
            <a
              href={url}
              download={`juspross-${item.kind}-${item.id}.${ext}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Descargar"
              title="Descargar"
              className="flex size-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
            >
              <Download className="size-3.5" />
            </a>
          )}
          <button
            onClick={() => closeWin(win.id)}
            aria-label="Cerrar"
            className="flex size-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </span>
      </div>
      <div className="p-2.5">
        {!url ? (
          <p className="px-8 py-10 font-mono text-[10px] tracking-[0.2em] text-white/40">
            CARGANDO…
          </p>
        ) : failed ? (
          <p className="max-w-[320px] px-4 py-8 text-center text-[12px] text-red-300">
            El archivo ya no está disponible (el enlace de Agnes caducó y no se guardó en este
            navegador).
          </p>
        ) : isVideo ? (
          <video
            src={url}
            className={media}
            controls
            autoPlay
            loop
            muted
            playsInline
            onError={() => setFailed(true)}
          />
        ) : (
          <img src={url} alt={item.prompt} className={media} onError={() => setFailed(true)} />
        )}
        <div className="mt-2 flex items-start gap-2">
          <p
            className="line-clamp-2 flex-1 text-[11.5px] leading-snug text-white/65"
            title={item.finalPrompt}
          >
            {item.prompt}
          </p>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(item.finalPrompt).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              });
            }}
            title="Copiar la descripción final que se envió a Agnes"
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[9px] tracking-[0.15em] text-white/45 hover:bg-white/10 hover:text-white"
          >
            <Copy className="size-3" />
            {copied ? "COPIADO" : "PROMPT"}
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] tracking-[0.15em] text-white/30">
          {item.model} · {item.size}
          {item.seconds ? ` · ${item.seconds} s` : ""}
        </p>
      </div>
    </div>
  );
}
