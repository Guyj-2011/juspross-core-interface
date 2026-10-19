import { useMemo, useState } from "react";
import { Film, Play, Trash2, X } from "lucide-react";
import { useMedia, type MediaItem } from "@/lib/juspross/mediaStore";
import { cn } from "@/lib/utils";
import { useItemUrl } from "./useItemUrl";

type Filter = "all" | "image" | "video";
const fmtDate = (t: number) =>
  new Date(t).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Historial de todas las imágenes y videos creados. */
export function MediaHistory() {
  const open = useMedia((s) => s.historyOpen);
  const setOpen = useMedia((s) => s.setHistoryOpen);
  const items = useMedia((s) => s.items);
  const clearAll = useMedia((s) => s.clearAll);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirm, setConfirm] = useState(false);

  const shown = useMemo(
    () => items.filter((i) => filter === "all" || i.kind === filter),
    [items, filter],
  );
  const nImg = items.filter((i) => i.kind === "image").length;
  const nVid = items.length - nImg;

  const tab = (id: Filter, label: string) => (
    <button
      key={id}
      onClick={() => setFilter(id)}
      className={cn(
        "rounded-full px-3 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors",
        filter === id ? "bg-[#ffc83a]/20 text-[#ffd36b]" : "text-white/45 hover:text-white",
      )}
    >
      {label}
    </button>
  );

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        "absolute top-0 right-0 bottom-0 z-40 flex w-[min(390px,92vw)] flex-col border-l border-[#ffc83a]/20 bg-black/88 backdrop-blur-xl transition-transform duration-300",
        open ? "pointer-events-auto translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <h2 className="font-mono text-[11px] tracking-[0.3em] text-[#ffd36b]">HISTORIAL</h2>
        <span className="font-mono text-[10px] tracking-[0.15em] text-white/35">
          {nImg} IMG · {nVid} VID
        </span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Cerrar historial"
          className="ml-auto flex size-8 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-1 px-3 py-2">
        {tab("all", "TODO")}
        {tab("image", "IMÁGENES")}
        {tab("video", "VIDEOS")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {shown.length === 0 ? (
          <p className="mt-10 px-6 text-center text-[12px] leading-relaxed text-white/40">
            {items.length === 0
              ? "Aquí aparecerán todas las imágenes y videos que crees."
              : "No hay nada de este tipo todavía."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {shown.map((it) => (
              <HistoryCard key={it.id} item={it} />
            ))}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="border-t border-white/10 px-4 py-2.5">
          {confirm ? (
            <div className="flex items-center gap-2 text-[11px] text-white/70">
              <span>¿Borrar todo el historial?</span>
              <button
                onClick={() => {
                  void clearAll();
                  setConfirm(false);
                }}
                className="rounded-md bg-red-500/20 px-2.5 py-1 font-mono text-[10px] tracking-[0.15em] text-red-300 hover:bg-red-500/30"
              >
                SÍ, BORRAR
              </button>
              <button
                onClick={() => setConfirm(false)}
                className="font-mono text-[10px] tracking-[0.15em] text-white/50 hover:text-white"
              >
                NO
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirm(true)}
              className="font-mono text-[10px] tracking-[0.18em] text-white/40 hover:text-red-300"
            >
              BORRAR TODO
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

function HistoryCard({ item }: { item: MediaItem }) {
  const url = useItemUrl(item);
  const openWin = useMedia((s) => s.openWin);
  const deleteItem = useMedia((s) => s.deleteItem);
  const isVideo = item.kind === "video";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openWin(item.id)}
      onKeyDown={(e) => e.key === "Enter" && openWin(item.id)}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] transition-colors hover:border-[#ffc83a]/50"
    >
      <div className="relative aspect-square bg-black">
        {url ? (
          isVideo ? (
            <video
              src={`${url}#t=0.1`}
              muted
              preload="metadata"
              className="size-full object-cover"
            />
          ) : (
            <img src={url} alt={item.prompt} loading="lazy" className="size-full object-cover" />
          )
        ) : (
          <div className="flex size-full items-center justify-center text-white/20">
            <Film className="size-5" />
          </div>
        )}
        {isVideo && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Play className="size-7 text-white/85 drop-shadow" fill="currentColor" />
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            void deleteItem(item.id);
          }}
          aria-label="Borrar"
          title="Borrar"
          className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md bg-black/70 text-white/70 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-300"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="px-2 py-1.5">
        <p className="line-clamp-2 text-[11px] leading-snug text-white/70">{item.prompt}</p>
        <p className="mt-1 font-mono text-[8.5px] tracking-[0.12em] text-white/30">
          {isVideo ? "VIDEO" : "IMAGEN"} · {fmtDate(item.createdAt).toUpperCase()}
        </p>
      </div>
    </div>
  );
}
