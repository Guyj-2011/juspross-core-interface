#!/usr/bin/env node
// Agente local de Juspross — abre Spotify y controla únicamente su ventana en Windows.
// Sin dependencias. Escucha solo en 127.0.0.1. No acepta comandos arbitrarios ni accede a archivos del usuario.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PORT = 47821;
export const VERSION = "1.1.0";
export const PUBLISHED_ORIGIN = "https://juspross.lovable.app";
export const PREVIEW_ORIGIN = "https://id-preview--87c1cdc9-dc13-4e05-88dd-b9b811c3a25d.lovable.app";
const MAX_BODY = 4096;
const CODE_TTL_MS = 5 * 60_000;
const MAX_PAIR_FAILS = 5;
const RATE_LIMIT = 20; // solicitudes por minuto

const sha256 = (v) => crypto.createHash("sha256").update(v).digest();

function defaultStateFile() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share");
  return path.join(base, "Juspross", "agent.json");
}

/** Detecta Spotify sin shell: claves de registro fijas o ejecutables en rutas conocidas. */
export function detectSpotifyWindows() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, "Spotify", "Spotify.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "Spotify.exe"),
  ].filter(Boolean);
  if (candidates.some((p) => fs.existsSync(p))) return Promise.resolve(true);
  const query = (key) =>
    new Promise((resolve) => {
      execFile("reg.exe", ["query", key], { shell: false, windowsHide: true, timeout: 4000 }, (err) => resolve(!err));
    });
  return query("HKCU\\Software\\Classes\\spotify").then((ok) => ok || query("HKCR\\spotify"));
}

/** Redimensiona únicamente la ventana principal de Spotify con una acción fija de Windows. */
export function resizeSpotifyWindow() {
  const script = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JusprossWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
$deadline = (Get-Date).AddSeconds(12)
do {
  $window = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($window) {
    [JusprossWindow]::ShowWindowAsync($window.MainWindowHandle, 9) | Out-Null
    [JusprossWindow]::SetWindowPos($window.MainWindowHandle, [IntPtr]::Zero, 48, 48, 560, 760, 0x0040) | Out-Null
    exit 0
  }
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
exit 2
`;
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    shell: false, windowsHide: true, timeout: 15_000,
  }, () => {});
}

/** Ejecuta únicamente controles de ventana permitidos; cerrar es un cierre normal, nunca un kill forzado. */
export function controlSpotifyWindow(action) {
  const scripts = {
    minimize: String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JusprossWindowControl {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
$window = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $window) { exit 2 }
if ([JusprossWindowControl]::ShowWindowAsync($window.MainWindowHandle, 6)) { exit 0 }
exit 3
`,
    maximize: String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JusprossWindowControl {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
$window = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $window) { exit 2 }
if ([JusprossWindowControl]::ShowWindowAsync($window.MainWindowHandle, 3)) { exit 0 }
exit 3
`,
    close: String.raw`
$window = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $window) { exit 2 }
if ($window.CloseMainWindow()) { exit 0 }
exit 3
`,
  };
  const script = scripts[action];
  if (!script) return Promise.resolve("invalid_action");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      shell: false, windowsHide: true, timeout: 8_000,
    }, (error) => resolve(error ? (error.code === 2 ? "window_not_found" : "window_action_failed") : "window_action_completed"));
  });
}

/** Acción fija: iniciar Spotify y ajustar su ventana a un tamaño compacto. */
export function launchSpotifyWindows() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, "Spotify", "Spotify.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "Spotify.exe"),
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));

  const launchProtocol = () => {
    const child = spawn("explorer.exe", ["spotify:"], {
      shell: false, windowsHide: true, detached: true, stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
    setTimeout(resizeSpotifyWindow, 1500);
  };

  if (!executable) {
    launchProtocol();
    return;
  }

  const child = spawn(executable, [], {
    shell: false, windowsHide: true, detached: true, stdio: "ignore",
  });
  child.once("error", launchProtocol);
  child.unref();
  setTimeout(resizeSpotifyWindow, 1500);
}

export function createAgent(opts = {}) {
  const allowPreview = Boolean(opts.allowPreview);
  const allowedOrigins = new Set([PUBLISHED_ORIGIN, ...(allowPreview ? [PREVIEW_ORIGIN] : [])]);
  const allowedHosts = new Set([`127.0.0.1:${opts.port ?? PORT}`, `localhost:${opts.port ?? PORT}`]);
  const now = opts.now ?? (() => Date.now());
  const detect = opts.detect ?? detectSpotifyWindows;
  const launch = opts.launch ?? launchSpotifyWindows;
  const stateFile = opts.stateFile ?? defaultStateFile();
  const log = opts.log ?? ((m) => console.log(`[juspross-agent] ${m}`));

  let tokenHash = null;
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (typeof saved.tokenHash === "string") tokenHash = Buffer.from(saved.tokenHash, "hex");
  } catch {}

  let pairCode = null;
  let pairExpires = 0;
  let pairFails = 0;
  const hits = [];

  const persist = () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(tokenHash ? { tokenHash: tokenHash.toString("hex"), pairedAt: new Date(now()).toISOString() } : {}), { mode: 0o600 });
  };

  const newPairCode = () => {
    pairCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    pairExpires = now() + CODE_TTL_MS;
    pairFails = 0;
    return pairCode;
  };

  const resetPairing = () => {
    tokenHash = null;
    persist();
  };

  const send = (res, status, body, origin) => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  const authorized = (req) => {
    const h = req.headers["authorization"];
    if (!tokenHash || typeof h !== "string" || !h.startsWith("Bearer ")) return false;
    const given = sha256(h.slice(7).trim());
    return given.length === tokenHash.length && crypto.timingSafeEqual(given, tokenHash);
  };

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("bad_json")); }
      });
      req.on("error", reject);
    });

  async function handle(req, res) {
    // 1) Host fijo (protección contra DNS rebinding).
    if (!allowedHosts.has(String(req.headers.host ?? ""))) return send(res, 403, { ok: false, reason: "bad_host" });
    // 2) Origen permitido, sin cabeceras CORS para nadie más.
    const origin = String(req.headers.origin ?? "");
    if (!allowedOrigins.has(origin)) return send(res, 403, { ok: false, reason: "bad_origin" });

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      });
      return res.end();
    }

    // 3) Límite de solicitudes.
    const t = now();
    while (hits.length && t - hits[0] > 60_000) hits.shift();
    if (hits.length >= RATE_LIMIT) return send(res, 429, { ok: false, reason: "rate_limited" }, origin);
    hits.push(t);

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return send(res, 200, { ok: true, name: "juspross-agent", version: VERSION, paired: Boolean(tokenHash), authorized: authorized(req) }, origin);
    }
    if (req.method !== "POST") return send(res, 404, { ok: false, reason: "not_found" }, origin);
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
      return send(res, 415, { ok: false, reason: "json_required" }, origin);

    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { ok: false, reason: "bad_request" }, origin); }

    if (url.pathname === "/v1/pair") {
      if (pairFails >= MAX_PAIR_FAILS) return send(res, 423, { ok: false, reason: "pairing_locked" }, origin);
      if (!pairCode || t > pairExpires) return send(res, 410, { ok: false, reason: "code_expired" }, origin);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const a = sha256(code), b = sha256(pairCode);
      if (!crypto.timingSafeEqual(a, b)) {
        pairFails += 1;
        log(`Código de emparejamiento incorrecto (${pairFails}/${MAX_PAIR_FAILS}).`);
        return send(res, 401, { ok: false, reason: pairFails >= MAX_PAIR_FAILS ? "pairing_locked" : "bad_code" }, origin);
      }
      pairCode = null; // un solo uso
      const token = crypto.randomBytes(32).toString("base64url");
      tokenHash = sha256(token);
      persist();
      log("Emparejado con Juspross.");
      return send(res, 200, { ok: true, token }, origin);
    }

    if (!authorized(req)) return send(res, 401, { ok: false, reason: "not_paired" }, origin);

    if (url.pathname === "/v1/unpair") {
      resetPairing();
      log("Emparejamiento revocado desde Juspross.");
      return send(res, 200, { ok: true }, origin);
    }
    if (url.pathname === "/v1/tools/open_spotify") {
      if (!(await detect())) return send(res, 200, { ok: false, reason: "not_installed" }, origin);
      launch();
      log("Se pidió a Windows abrir Spotify.");
      return send(res, 200, { ok: true, reason: "launch_requested" }, origin);
    }
    if (url.pathname === "/v1/tools/spotify_window") {
      const action = typeof body.action === "string" ? body.action : "";
      if (!["minimize", "maximize", "close"].includes(action))
        return send(res, 400, { ok: false, reason: "invalid_action" }, origin);
      const result = await controlSpotifyWindow(action);
      if (result === "window_not_found")
        return send(res, 200, { ok: false, reason: "window_not_found" }, origin);
      if (result !== "window_action_completed")
        return send(res, 200, { ok: false, reason: "window_action_failed" }, origin);
      log(`Se ejecutó el control de ventana Spotify: ${action}.`);
      return send(res, 200, { ok: true, reason: "window_action_completed", action }, origin);
    }
    return send(res, 404, { ok: false, reason: "not_found" }, origin);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { ok: false, reason: "internal" }));
  });
  return { server, newPairCode, resetPairing, isPaired: () => Boolean(tokenHash) };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  if (process.platform !== "win32" && !dryRun) {
    console.error("Este agente está pensado para Windows. Usa --dry-run para probarlo en otro sistema.");
    process.exit(1);
  }
  const agent = createAgent({
    allowPreview: args.has("--allow-preview"),
    ...(dryRun ? { detect: async () => true, launch: () => console.log("[dry-run] Se habría abierto spotify:") } : {}),
  });
  if (args.has("--reset")) {
    agent.resetPairing();
    console.log("Emparejamiento borrado. Juspross ya no puede usar este equipo.");
    process.exit(0);
  }
  agent.server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `El puerto ${PORT} ya está en uso. ¿Hay otro agente abierto?` : `Error: ${e.message}`);
    process.exit(1);
  });
  agent.server.listen(PORT, "127.0.0.1", () => {
    console.log(`Agente local de Juspross ${VERSION} escuchando solo en http://127.0.0.1:${PORT}`);
    console.log(agent.isPaired() ? "Ya hay un emparejamiento guardado." : "Aún no está emparejado.");
    console.log(`Código de emparejamiento (válido 5 min, un solo uso): ${agent.newPairCode()}`);
    console.log("Pulsa Ctrl+C para detener el agente.");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
