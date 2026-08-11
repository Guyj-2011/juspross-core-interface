import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle?: string;
  initial: { x: number; y: number };
  width?: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** Panel holográfico flotante, arrastrable dentro del espacio 3D. */
export function HoloWindow({ title, subtitle, initial, width = 380, onClose, children, className }: Props) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onMove = useCallback((e: PointerEvent) => {
    if (!drag.current) return;
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

  return (
    <section
      className={cn(
        "holo scan-line pointer-events-auto absolute z-30 animate-rise overflow-hidden rounded-md",
        className,
      )}
      style={{ left: pos.x, top: pos.y, width }}
    >
      <header
        className="flex cursor-grab items-center justify-between gap-3 border-b border-border/60 px-3 py-2 active:cursor-grabbing"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 rounded-full bg-cyan shadow-[0_0_10px_var(--cyan)]" />
          <h2 className="truncate font-mono text-[11px] tracking-[0.22em] text-foreground/90 uppercase">
            {title}
          </h2>
          {subtitle && <span className="label-xs truncate">{subtitle}</span>}
        </div>
        <button
          onClick={onClose}
          aria-label={`Cerrar ${title}`}
          className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-cyan"
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div className="max-h-[62vh] overflow-y-auto px-3 py-3">{children}</div>
      <div className="hairline h-px w-full opacity-60" />
    </section>
  );
}