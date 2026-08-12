import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, MicOff, Paperclip, Square, X } from "lucide-react";
import { useJuspross } from "@/lib/juspross/store";
import { useRuntime } from "@/lib/juspross/useRuntime";
import { useSpeechRecognition, speechSupported } from "@/lib/juspross/useSpeech";
import { createMicAnalyser, cue } from "@/lib/juspross/audio";
import { cn } from "@/lib/utils";

interface Attachment {
  name: string;
  size: number;
  kind: string;
}

export function CommandBar() {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const stopMicRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setVoiceReady(speechSupported());
  }, []);

  const { submit, abort } = useRuntime();
  const micEnabled = useJuspross((s) => s.micEnabled);
  const setMic = useJuspross((s) => s.setMic);
  const state = useJuspross((s) => s.systemState);
  const sound = useJuspross((s) => s.soundEnabled);

  const rec = useSpeechRecognition({
    onInterim: (t) => useJuspross.getState().setTranscript(t, true),
    onFinal: (t) => {
      useJuspross.getState().setTranscript(t, false);
      void submit(t, "voice", files);
      setFiles([]);
    },
    onWake: () => {
      const s = useJuspross.getState();
      s.setState("listening", "LISTENING");
      s.setTranscript("", true);
      cue("activate", s.soundEnabled);
    },
    onError: (msg) => useJuspross.getState().setError(msg),
  });

  useEffect(() => {
    if (!micEnabled) {
      rec.stop();
      stopMicRef.current?.();
      stopMicRef.current = null;
      useJuspross.getState().setAmplitude(0);
      return;
    }
    rec.start();
    let cancelled = false;
    void createMicAnalyser((v) => {
      const s = useJuspross.getState();
      if (s.systemState === "listening") s.setAmplitude(v * 0.8);
    })
      .then((stop) => {
        if (cancelled) stop();
        else stopMicRef.current = stop;
      })
      .catch(() => useJuspross.getState().setError("No se pudo acceder al micrófono"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micEnabled]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  }, [value]);

  const send = () => {
    if (!value.trim()) return;
    void submit(value, "text", files);
    setValue("");
    setFiles([]);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [
      ...f,
      ...Array.from(list).map((x) => ({ name: x.name, size: x.size, kind: x.type || "file" })),
    ]);
  };

  const busy = state === "thinking" || state === "processing" || state === "speaking";

  return (
    <div
      className="pointer-events-auto absolute bottom-7 left-1/2 z-30 w-[min(720px,72vw)] -translate-x-1/2"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="holo flex items-center gap-2 rounded-sm px-2 py-1 font-mono text-[10px] tracking-wider text-foreground/80"
            >
              {f.name}
              <button
                onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}
                aria-label={`Quitar ${f.name}`}
              >
                <X className="size-3 text-muted-foreground hover:text-amber" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        className={cn(
          "holo relative flex items-end gap-2 rounded-md px-2.5 py-2 transition-shadow",
          dragging && "shadow-[0_0_0_1px_var(--cyan)]",
          micEnabled && "shadow-[0_0_36px_-12px_var(--cyan)]",
        )}
      >
        <button
          onClick={() => {
            setMic(!micEnabled);
            cue("interact", sound);
          }}
          aria-label={micEnabled ? "Desactivar escucha" : "Activar escucha por voz"}
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-sm transition-colors",
            micEnabled ? "bg-primary/15 text-cyan" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {micEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {micEnabled && (
            <span className="absolute inset-0 animate-blip rounded-sm ring-1 ring-cyan/40" />
          )}
        </button>

        <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground">
          <Paperclip className="size-4" />
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.md"
          />
        </label>

        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            micEnabled ? 'Di "Hey Juspross" o escribe una instrucción' : "Escribe una instrucción para Juspross"
          }
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />

        {busy ? (
          <button
            onClick={abort}
            aria-label="Interrumpir a Juspross"
            className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-amber/15 text-amber transition-colors hover:bg-amber/25"
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!value.trim()}
            aria-label="Enviar"
            className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-cyan transition-colors hover:bg-primary/25 disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>

      <p className="mt-2 text-center font-mono text-[10px] tracking-[0.24em] text-muted-foreground/70">
        {voiceReady
          ? 'VOZ Y TEXTO SIMULTÁNEOS · PALABRA DE ACTIVACIÓN "HEY JUSPROSS"'
          : "VOZ NO DISPONIBLE EN ESTE NAVEGADOR · ENTRADA DE TEXTO ACTIVA"}
      </p>
    </div>
  );
}