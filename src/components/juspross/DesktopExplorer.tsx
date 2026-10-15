import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  File as FileIcon,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

interface DesktopFile {
  name: string;
  path: string;
  size: number;
  lastModified: number;
}

interface FileHandleLike {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
}

interface DirectoryHandleLike {
  kind: "directory";
  name: string;
  values: () => AsyncIterable<DirectoryEntryLike>;
}

type DirectoryEntryLike = FileHandleLike | DirectoryHandleLike;

interface WindowWithDirectoryPicker {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" | "home" | "recent";
  }) => Promise<DirectoryHandleLike>;
}

async function scanDirectory(
  directory: DirectoryHandleLike,
  prefix = "",
): Promise<DesktopFile[]> {
  const files: DesktopFile[] = [];

  for await (const entry of directory.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.kind === "directory") {
      files.push(...(await scanDirectory(entry, path)));
      continue;
    }

    const file = await entry.getFile();
    files.push({
      name: entry.name,
      path,
      size: file.size,
      lastModified: file.lastModified,
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path, "es"));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toLocaleString("es-MX", { maximumFractionDigits: exponent === 0 ? 0 : 1 })} ${units[exponent]}`;
}

function formatModified(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Local, read-only desktop listing. The browser only gets access after the
 * user chooses a folder through the native picker. File contents are not read
 * or uploaded; this component displays names and basic metadata only.
 */
export function DesktopExplorer() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<DesktopFile[]>([]);
  const [folderName, setFolderName] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSelectedFolder, setHasSelectedFolder] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryRef = useRef<DirectoryHandleLike | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const filteredFiles = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    if (!term) return files;
    return files.filter(
      (file) =>
        file.name.toLocaleLowerCase("es").includes(term) ||
        file.path.toLocaleLowerCase("es").includes(term),
    );
  }, [files, query]);

  const chooseFolder = async () => {
    setError("");
    const pickerWindow = window as unknown as WindowWithDirectoryPicker;

    if (!pickerWindow.showDirectoryPicker) {
      setLoading(false);
      inputRef.current?.click();
      return;
    }

    setLoading(true);
    try {
      const directory = await pickerWindow.showDirectoryPicker({
        id: "juspross-desktop",
        mode: "read",
        startIn: "desktop",
      });
      directoryRef.current = directory;
      setFolderName(directory.name);
      setHasSelectedFolder(true);
      const nextFiles = await scanDirectory(directory);
      setFiles(nextFiles);
      setQuery("");
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      if (name !== "AbortError") {
        setError(
          "No se pudo leer esa carpeta. Comprueba el permiso del navegador o vuelve a seleccionarla.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshFiles = async () => {
    if (!directoryRef.current) {
      await chooseFolder();
      return;
    }

    setLoading(true);
    setError("");
    try {
      setFiles(await scanDirectory(directoryRef.current));
    } catch {
      setError(
        "No se pudo actualizar el listado. Selecciona de nuevo la carpeta para renovar el permiso.",
      );
    } finally {
      setLoading(false);
    }
  };

  const openExplorer = () => {
    setOpen(true);
    if (!hasSelectedFolder) void chooseFolder();
  };

  const handleFallbackInput = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!selected.length) return;

    const rootName = selected[0]?.webkitRelativePath.split("/")[0] || "Escritorio";
    const nextFiles = selected.map((file) => ({
      name: file.name,
      path: file.webkitRelativePath || file.name,
      size: file.size,
      lastModified: file.lastModified,
    }));

    setFolderName(rootName);
    setFiles(nextFiles.sort((a, b) => a.path.localeCompare(b.path, "es")));
    setHasSelectedFolder(true);
    setDirectoryFallbackNotice();
    setQuery("");
    setError("");
    setLoading(false);
  };

  const setDirectoryFallbackNotice = () => {
    directoryRef.current = null;
  };

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-[45]">
        <button
          type="button"
          onClick={openExplorer}
          title="Mostrar archivos del Escritorio"
          aria-label="Mostrar archivos del Escritorio"
          className="pointer-events-auto absolute left-5 top-[4.25rem] flex items-center gap-2 rounded-md border border-[#6ea8ff]/35 bg-black/60 px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-[#b9d3ff] shadow-[0_0_24px_-12px_#3d7bff] backdrop-blur-md transition-colors hover:border-[#6ea8ff]/70 hover:bg-[#16305a]/70"
        >
          <FolderOpen className="size-4" strokeWidth={1.7} />
          <span>ESCRITORIO</span>
        </button>
      </div>

      <input
        ref={(node) => {
          inputRef.current = node;
          if (node) {
            node.setAttribute("webkitdirectory", "");
            node.setAttribute("directory", "");
          }
        }}
        type="file"
        multiple
        className="hidden"
        onChange={handleFallbackInput}
        aria-label="Seleccionar carpeta Escritorio"
      />

      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
          <button
            type="button"
            aria-label="Cerrar explorador"
            className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-md"
            onClick={() => setOpen(false)}
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-explorer-title"
            className="relative flex max-h-[86vh] w-[min(940px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-[#6ea8ff]/35 bg-[#050a14]/95 text-white shadow-[0_0_80px_-20px_#245ac7] backdrop-blur-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[#6ea8ff]/25 bg-[#1d3a69]/35 text-[#9dc4ff]">
                  <HardDrive className="size-5" strokeWidth={1.6} />
                </div>
                <div className="min-w-0">
                  <h2
                    id="desktop-explorer-title"
                    className="font-mono text-sm tracking-[0.22em] text-white/95"
                  >
                    EXPLORADOR DE ARCHIVOS
                  </h2>
                  <p className="mt-1 truncate font-mono text-[10px] tracking-[0.1em] text-white/45">
                    {hasSelectedFolder
                      ? `${folderName} · ${files.length} archivos · SOLO LECTURA`
                      : "SELECCIONA TU ESCRITORIO PARA COMENZAR"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="flex flex-col gap-2 border-b border-white/10 p-3 sm:flex-row sm:items-center sm:px-5">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-black/40 px-3">
                <Search className="size-4 shrink-0 text-white/35" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por nombre o carpeta…"
                  className="h-10 min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-white/30"
                />
              </label>
              <button
                type="button"
                onClick={() => void chooseFolder()}
                disabled={loading}
                className="flex h-10 items-center justify-center gap-2 rounded-md border border-[#6ea8ff]/30 bg-[#173363]/30 px-3 font-mono text-[10px] tracking-[0.12em] text-[#b9d3ff] transition-colors hover:bg-[#214783]/45 disabled:opacity-50"
              >
                <FolderOpen className="size-3.5" />
                ELEGIR CARPETA
              </button>
              <button
                type="button"
                onClick={() => void refreshFiles()}
                disabled={loading || !hasSelectedFolder}
                title="Actualizar listado"
                aria-label="Actualizar listado"
                className="flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 font-mono text-[10px] tracking-[0.12em] text-white/65 transition-colors hover:bg-white/5 disabled:opacity-35"
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                ACTUALIZAR
              </button>
            </div>

            {error && (
              <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-100/90 sm:mx-5">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
              {loading ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="size-7 animate-spin text-[#85b5ff]" />
                  <p className="font-mono text-xs tracking-[0.16em] text-white/65">
                    LEYENDO NOMBRES Y METADATOS…
                  </p>
                </div>
              ) : !hasSelectedFolder ? (
                <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
                  <FolderOpen className="size-10 text-[#85b5ff]/70" strokeWidth={1.3} />
                  <p className="font-mono text-xs tracking-[0.18em] text-white/85">
                    ACCESO AL ESCRITORIO
                  </p>
                  <p className="max-w-md text-sm leading-relaxed text-white/50">
                    En el selector de Windows, elige la carpeta Escritorio. Juspross mostrará los
                    archivos y sus carpetas sin subirlos a Internet.
                  </p>
                  <button
                    type="button"
                    onClick={() => void chooseFolder()}
                    className="mt-2 rounded-md border border-[#6ea8ff]/35 bg-[#16305a]/45 px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-[#b9d3ff] hover:bg-[#214783]/45"
                  >
                    SELECCIONAR ESCRITORIO
                  </button>
                </div>
              ) : files.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                  <FolderOpen className="size-8 text-white/30" strokeWidth={1.3} />
                  <p className="text-sm text-white/65">No se encontraron archivos en esta carpeta.</p>
                  <p className="text-xs text-white/35">Puedes elegir otra carpeta o actualizar el listado.</p>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center text-sm text-white/45">
                  No hay archivos que coincidan con «{query}».
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-white/10">
                  <div className="grid grid-cols-[minmax(0,1fr)_70px] gap-3 border-b border-white/10 bg-white/[0.035] px-3 py-2 font-mono text-[9px] tracking-[0.16em] text-white/40 sm:grid-cols-[minmax(0,1fr)_90px_145px]">
                    <span>NOMBRE / UBICACIÓN</span>
                    <span className="text-right">TAMAÑO</span>
                    <span className="hidden text-right sm:block">MODIFICADO</span>
                  </div>
                  {filteredFiles.map((file) => (
                    <div
                      key={file.path}
                      className="grid grid-cols-[minmax(0,1fr)_70px] gap-3 border-b border-white/[0.055] px-3 py-2.5 last:border-b-0 hover:bg-[#1e3d6b]/20 sm:grid-cols-[minmax(0,1fr)_90px_145px]"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <FileIcon className="mt-0.5 size-4 shrink-0 text-[#88b6ff]/75" strokeWidth={1.5} />
                        <div className="min-w-0">
                          <p className="truncate text-xs text-white/90" title={file.name}>
                            {file.name}
                          </p>
                          <p className="mt-1 truncate font-mono text-[9px] text-white/35" title={file.path}>
                            {file.path.includes("/") ? file.path : folderName}
                          </p>
                        </div>
                      </div>
                      <span className="self-center text-right font-mono text-[10px] text-white/55">
                        {formatBytes(file.size)}
                      </span>
                      <span className="hidden self-center text-right font-mono text-[10px] text-white/45 sm:block">
                        {formatModified(file.lastModified)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 font-mono text-[9px] tracking-[0.09em] text-white/35 sm:px-5">
              <span>ACCESO LOCAL · SOLO NOMBRES Y METADATOS · SIN SUBIR ARCHIVOS</span>
              {hasSelectedFolder && (
                <span>
                  {filteredFiles.length === files.length
                    ? `${files.length} ELEMENTOS`
                    : `${filteredFiles.length} DE ${files.length} ELEMENTOS`}
                </span>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
