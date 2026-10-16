import { useV2, type Mode } from "@/lib/juspross/v2Store";
import { cn } from "@/lib/utils";

const OPTIONS: { id: Mode; label: string; hint: string }[] = [
  { id: "calm", label: "CALMADO", hint: "Lado calmado" },
  { id: "v2", label: "2.0", hint: "Lado 2.0" },
  { id: "media", label: "IMA/VID", hint: "Imagen y video" },
];

/** Botón inferior izquierdo para cambiar entre el lado calmado, el lado 2.0 e IMA/VID. */
export function ModeSwitch() {
  const mode = useV2((s) => s.mode);
  const setMode = useV2((s) => s.setMode);

  const shell =
    mode === "v2"
      ? "border-[#3d7bff]/40 bg-black/70"
      : mode === "media"
        ? "border-emerald-400/35 bg-black/60"
        : "border-cyan/30 bg-background/60";
  const activeCls =
    mode === "v2"
      ? "bg-[#3d7bff]/25 text-[#9cc0ff] shadow-[0_0_18px_-4px_#3d7bff]"
      : mode === "media"
        ? "bg-emerald-400/20 text-emerald-200 shadow-[0_0_18px_-4px_#34d399]"
        : "bg-cyan/20 text-cyan shadow-[0_0_18px_-4px_var(--cyan)]";

  return (
    <div
      role="group"
      aria-label="Cambiar de lado"
      className={cn(
        "pointer-events-auto absolute bottom-5 left-5 z-50 flex items-center gap-0.5 rounded-full border p-0.5 font-mono text-[10px] tracking-[0.2em] backdrop-blur-md",
        shell,
      )}
    >
      {OPTIONS.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setMode(o.id)}
            aria-pressed={active}
            title={o.hint}
            className={cn(
              "rounded-full px-2.5 py-1.5 transition-colors",
              active ? activeCls : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
