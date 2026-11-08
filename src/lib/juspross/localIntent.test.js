import { describe, expect, test } from "bun:test";
import { isOpenSpotifyIntent } from "./localIntent";
import { describeLocalResult } from "./localAgent";

describe("intención abrir Spotify", () => {
  test("detecta abrir la app", () => {
    expect(isOpenSpotifyIntent("abre Spotify")).toBe(true);
    expect(isOpenSpotifyIntent("Ábreme spotify por favor")).toBe(true);
    expect(isOpenSpotifyIntent("inicia Spotify")).toBe(true);
  });
  test("no intercepta control de reproducción", () => {
    expect(isOpenSpotifyIntent("pon música en Spotify")).toBe(false);
    expect(isOpenSpotifyIntent("pausa Spotify")).toBe(false);
    expect(isOpenSpotifyIntent("abre Spotify y reproduce Daft Punk")).toBe(false);
    expect(isOpenSpotifyIntent("siguiente canción en spotify")).toBe(false);
    expect(isOpenSpotifyIntent("abre el navegador")).toBe(false);
  });
});

describe("mensajes del agente local", () => {
  test("solo afirma apertura con éxito real", () => {
    expect(describeLocalResult({ ok: true, reason: "launch_requested" })).toContain("pidió a Windows abrir Spotify");
    for (const reason of ["not_running", "not_paired", "blocked_by_browser", "not_installed"]) {
      expect(describeLocalResult({ ok: false, reason })).toContain("No pude abrir Spotify");
    }
  });
});
