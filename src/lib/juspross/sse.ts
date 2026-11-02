/**
 * Parser SSE incremental compartido (servidor y navegador).
 * Soporta fragmentos cortados en cualquier punto, CRLF, varias líneas `data:`
 * por evento y comentarios. Llama a `onEvent` con el campo `data` completo.
 */
export function createSseParser(onEvent: (data: string, event: string) => void) {
  let buf = "";
  let data: string[] = [];
  let event = "message";

  const dispatch = () => {
    if (data.length) onEvent(data.join("\n"), event);
    data = [];
    event = "message";
  };

  const line = (raw: string) => {
    const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (l === "") return dispatch();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value || "message";
  };

  return {
    push(chunk: string) {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        line(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    },
    /** Procesa lo pendiente al cerrar el stream (evento sin línea en blanco final). */
    end() {
      if (buf) line(buf);
      buf = "";
      dispatch();
    },
  };
}

/**
 * Filtra el razonamiento privado del contenido acumulado: elimina bloques
 * <think>…</think> (y uno abierto sin cerrar) para entregar solo la respuesta final.
 */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trimStart();
}
