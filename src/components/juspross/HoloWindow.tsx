import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle?: string;
  position: { x: number; y: number };
  width?: number;
  accent?: string;
  accent2?: string;
  maxBodyHeight?: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** Panel holográfico flotante, arrastrable dentro del espacio 3D. */
export function HoloWindow({
  title,
  subtitle,
  position,
  width = 380,
  accent = "var(--cyan)",
  accent2 = "var(--violet)",
  maxBodyHeight,
  onClose,
  children,
  className,
}: Props) {
  const [pos, setPos] = useState(position);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const moved = useRef(false);

  // Reflow automático mientras el usuario no haya movido el panel a mano.
  useEffect(() => {
    if (!moved.current) setPos(position);
  }, [position]);

  const onMove = useCallback((e: PointerEvent) => {
    if (!drag.current) return;
    moved.current = true;
    setPos({
      x: Math.max(8, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx)),
      y: Math.max(8, Math.min(window.innerHeight - 60, e.clientY - drag.current.dy)),
    });
  }, []);

  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
    };
  }, [onMove]);

  const style = {
    left: pos.x,
    top: pos.y,
    width,
    "--accent": accent,
    "--accent2": accent2,
    borderColor: "color-mix(in oklab, var(--accent) 38%, transparent)",
    boxShadow:
      "0 0 0 1px color-mix(in oklab, var(--accent) 14%, transparent), 0 22px 60px -20px color-mix(in oklab, var(--accent) 45%, transparent), inset 0 1px 0 color-mix(in oklab, var(--accent) 22%, transparent)",
  } as CSSProperties;

  return (
    <section
      className={cn(
        "holo holo-bracket scan-line pointer-events-auto absolute z-30 animate-rise overflow-hidden rounded-none",
        className,
      )}
      style={style}
    >
      {/* halo de color propio del panel */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 55%), radial-gradient(90% 70% at 100% 100%, color-mix(in oklab, var(--accent2) 14%, transparent), transparent 60%)",
        }}
      />
      {/* barrido de escaneo vertical */}
      <div
        aria-hidden
        className="animate-scan pointer-events-none absolute inset-x-0 top-0 z-10 h-16 opacity-40"
        style={{
          background:
            "linear-gradient(to bottom, transparent, color-mix(in oklab, var(--accent) 26%, transparent), transparent)",
        }}
      />
      <header
        className="relative flex cursor-grab items-center justify-between gap-3 border-b px-3 py-2 active:cursor-grabbing"
        style={{
          borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
          background:
            "linear-gradient(90deg, color-mix(in oklab, var(--accent) 26%, transparent), transparent 58%, color-mix(in oklab, var(--accent2) 22%, transparent))",
        }}
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="animate-blip size-1.5 rounded-full"
            style={{ background: "var(--accent)", boxShadow: "0 0 12px var(--accent)" }}
          />
          <h2
            className="truncate font-mono text-[11px] tracking-[0.22em] uppercase"
            style={{ color: "color-mix(in oklab, var(--accent) 70%, white)" }}
          >
            {title}
          </h2>
          {subtitle && <span className="label-xs truncate">{subtitle}</span>}
        </div>
        <button
          onClick={onClose}
          aria-label={`Cerrar ${title}`}
          className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-primary/10"
          style={{ ["--tw-text-opacity" as string]: 1 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "")}
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--accent), var(--accent2), transparent)",
          opacity: 0.7,
        }}
      />
      <div
        className="relative overflow-y-auto px-3 py-3"
        style={{ maxHeight: maxBodyHeight ?? "62vh" }}
      >
        {children}
      </div>
      <div
        className="h-px w-full opacity-40"
        style={{ background: "linear-gradient(90deg, transparent, var(--accent2), transparent)" }}
      />
    </section>
  );
}
