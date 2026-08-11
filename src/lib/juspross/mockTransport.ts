import type { EventSink, Transport } from "./n8n";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

function reply(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("short"))
    return "He preparado la ruta de producción del short. El guion está listo y el material queda en revisión antes de publicar.";
  if (m.includes("analytic") || m.includes("estadís") || m.includes("datos"))
    return "Los últimos veintiocho días acumulan trescientas doce mil reproducciones, con una retención media del cincuenta y ocho por ciento.";
  if (m.includes("hola") || m.includes("hey"))
    return "Aquí estoy. Todos los sistemas responden con normalidad. ¿Qué necesitas?";
  return "He procesado tu solicitud. El investigador reunió las fuentes, el curador las priorizó y el guionista redactó la propuesta.";
}

/** Runner local que emite la misma secuencia de eventos que emitirá n8n. */
export function createMockTransport(): Transport {
  return {
    id: "mock",
    async test() {
      await new Promise((r) => setTimeout(r, 420));
      return { ok: false, ms: 420, detail: "Sin webhook configurado — runner local" };
    },
    async send(req, onEvent: EventSink, signal) {
      const steps: [number, () => void][] = [
        [220, () => onEvent({ kind: "agent", agent: "planificador", status: "active", message: "Interpretando intención" })],
        [700, () => onEvent({ kind: "agent", agent: "planificador", status: "processing", message: "Construyendo plan" })],
        [900, () => onEvent({ kind: "agent", agent: "planificador", status: "completed", message: "Plan entregado" })],
        [200, () => onEvent({ kind: "agent", agent: "director", status: "active", message: "Solicitud recibida" })],
        [500, () => onEvent({ kind: "agent", agent: "investigador", status: "active", message: "Investigación iniciada" })],
        [1400, () => onEvent({ kind: "agent", agent: "investigador", status: "processing", message: "Cruzando 14 fuentes" })],
        [1500, () => onEvent({ kind: "agent", agent: "investigador", status: "completed", message: "Investigación completada" })],
        [400, () => onEvent({ kind: "agent", agent: "curador", status: "active", message: "Procesamiento iniciado" })],
        [1300, () => onEvent({ kind: "agent", agent: "curador", status: "completed", message: "Material priorizado" })],
        [400, () => onEvent({ kind: "agent", agent: "guionista", status: "active", message: "Redactando guion" })],
        [1500, () => onEvent({ kind: "agent", agent: "guionista", status: "completed", message: "Guion entregado" })],
        [300, () => onEvent({ kind: "agent", agent: "director", status: "completed", message: "Flujo consolidado" })],
      ];
      for (const [d, fn] of steps) {
        await wait(d, signal);
        fn();
      }
      await wait(250, signal);
      onEvent({ kind: "speak", text: reply(req.message) });
      onEvent({ kind: "done", message: "Tarea completada" });
    },
  };
}