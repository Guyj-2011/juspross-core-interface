import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgent, PUBLISHED_ORIGIN } from "./juspross-agent.mjs";

let agent, base, code, launches, stateFile;
const PORT_T = 47999;

beforeEach(async () => {
  launches = 0;
  stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jag-")), "agent.json");
  agent = createAgent({ port: PORT_T, stateFile, detect: async () => true, launch: () => { launches++; }, log: () => {} });
  code = agent.newPairCode();
  await new Promise((r) => agent.server.listen(PORT_T, "127.0.0.1", r));
  base = `http://127.0.0.1:${PORT_T}`;
});
afterEach(() => new Promise((r) => agent.server.close(r)));

const post = (p, body, headers = {}) =>
  fetch(base + p, { method: "POST", headers: { Origin: PUBLISHED_ORIGIN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body ?? {}) });

describe("agente local", () => {
  test("rechaza un origen ajeno sin CORS", async () => {
    const r = await post("/v1/tools/open_spotify", {}, { Origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    expect(launches).toBe(0);
  });
  test("rechaza un Host distinto (DNS rebinding)", async () => {
    const r = await fetch(base + "/v1/health", { headers: { Origin: PUBLISHED_ORIGIN, Host: "evil.example:47999" } });
    expect(r.status).toBe(403);
  });
  test("sin token o token incorrecto no abre nada", async () => {
    expect((await post("/v1/tools/open_spotify")).status).toBe(401);
    expect((await post("/v1/tools/open_spotify", {}, { Authorization: "Bearer nope" })).status).toBe(401);
    expect(launches).toBe(0);
  });
  test("emparejamiento de un solo uso y apertura con token", async () => {
    const r = await post("/v1/pair", { code });
    expect(r.status).toBe(200);
    const { token } = await r.json();
    expect(token.length).toBeGreaterThan(40);
    expect((await post("/v1/pair", { code })).status).toBe(410);
    const o = await post("/v1/tools/open_spotify", { path: "C:/Windows/evil.exe" }, { Authorization: `Bearer ${token}` });
    expect(await o.json()).toEqual({ ok: true, reason: "launch_requested" });
    expect(launches).toBe(1);
    expect(fs.readFileSync(stateFile, "utf8")).not.toContain(token);
  });
  test("5 códigos incorrectos bloquean el emparejamiento", async () => {
    for (let i = 0; i < 5; i++) await post("/v1/pair", { code: "000000x" });
    expect((await post("/v1/pair", { code })).status).toBe(423);
  });
  test("ruta desconocida devuelve 404", async () => {
    expect((await post("/v1/exec", { cmd: "calc" })).status).toBe(401);
    const { token } = await (await post("/v1/pair", { code })).json();
    expect((await post("/v1/exec", { cmd: "calc" }, { Authorization: `Bearer ${token}` })).status).toBe(404);
    expect(launches).toBe(0);
  });
  test("límite de solicitudes", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await fetch(base + "/v1/health", { headers: { Origin: PUBLISHED_ORIGIN } })).status;
    expect(last).toBe(429);
  });
});
