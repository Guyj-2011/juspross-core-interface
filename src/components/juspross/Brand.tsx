import { useJuspross } from "@/lib/juspross/store";

/** Marca superior izquierda + título central, como en la referencia. */
export function Brand() {
  const state = useJuspross((s) => s.systemState);

  return (
    <>
      <div className="pointer-events-none absolute top-4 left-5 z-30 flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-cyan shadow-[0_0_10px_var(--cyan)]" />
        <span className="font-mono text-[11px] tracking-[0.24em] text-foreground/85">
          JUSPROSS OS
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">v2.0.1</span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex flex-col items-center">
        <h1 className="text-[34px] leading-none font-light tracking-[0.34em] text-foreground/95">
          JUSPROSS
        </h1>
        <p className="mt-2 font-mono text-[11px] tracking-[0.42em] text-foreground/60">AI OS</p>
        <span className="mt-2 h-px w-56 bg-gradient-to-r from-transparent via-cyan/50 to-transparent" />
        <p className="mt-2 font-mono text-[10px] tracking-[0.34em] text-cyan/90">
          {state === "error" ? "NÚCLEO EN FALLO" : "NÚCLEO ONLINE"}
        </p>
      </div>
    </>
  );
}