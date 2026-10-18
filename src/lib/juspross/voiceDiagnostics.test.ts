import { expect, test } from "bun:test";
import { collectVoiceDiagnostic, formatVoiceDiagnostic, WHISPER_ENDPOINT } from "./voiceDiagnostics";

test("diagnostic preserves error, each API, permission and the actual local endpoint", () => {
  const diagnostic = formatVoiceDiagnostic("HTTP 503: Whisper no disponible", {
    secureContext: true,
    getUserMedia: true,
    mediaRecorder: false,
    audioContext: true,
    speechRecognition: false,
    microphonePermission: "denied",
  });
  expect(diagnostic).toContain("HTTP 503: Whisper no disponible");
  expect(diagnostic).toContain("getUserMedia: disponible");
  expect(diagnostic).toContain("MediaRecorder: no disponible");
  expect(diagnostic).toContain("AudioContext: disponible");
  expect(diagnostic).toContain("SpeechRecognition: no disponible");
  expect(diagnostic).toContain("Permiso del micrófono: denied");
  expect(WHISPER_ENDPOINT).toBe("http://127.0.0.1:8001/transcribe");
  expect(diagnostic).toContain(WHISPER_ENDPOINT);
});

test("unsupported permission queries are reported as unknown, not denied", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { isSecureContext: true } });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { permissions: { query: async () => { throw new Error("Unsupported"); } } },
    });
    const diagnostic = await collectVoiceDiagnostic("Capture failed");
    expect(diagnostic).toContain("Permiso del micrófono: no disponible");
    expect(diagnostic).not.toContain("Permiso del micrófono: denied");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});