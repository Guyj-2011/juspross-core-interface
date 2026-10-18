export const WHISPER_ENDPOINT = "http://127.0.0.1:8001/transcribe";

export interface VoiceCapabilities {
  secureContext: boolean;
  getUserMedia: boolean;
  mediaRecorder: boolean;
  audioContext: boolean;
  speechRecognition: boolean;
  microphonePermission: string;
}

export function formatVoiceDiagnostic(error: string, capabilities: VoiceCapabilities): string {
  const available = (value: boolean) => value ? "disponible" : "no disponible";
  return [
    "Juspross 2.0 · Diagnóstico de voz",
    `Error: ${error}`,
    `Contexto seguro: ${capabilities.secureContext ? "sí" : "no"}`,
    `getUserMedia: ${available(capabilities.getUserMedia)}`,
    `MediaRecorder: ${available(capabilities.mediaRecorder)}`,
    `AudioContext: ${available(capabilities.audioContext)}`,
    `SpeechRecognition: ${available(capabilities.speechRecognition)}`,
    `Permiso del micrófono: ${capabilities.microphonePermission}`,
    `Servidor local Whisper: ${WHISPER_ENDPOINT}`,
  ].join("\n");
}

export async function collectVoiceDiagnostic(error: string): Promise<string> {
  let microphonePermission = "no disponible (el navegador no permite consultarlo)";
  try {
    if (navigator.permissions?.query) {
      const permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
      microphonePermission = permission.state;
    }
  } catch {
    // An unsupported permission query is not evidence that access was denied.
  }
  const browser = window as unknown as {
    AudioContext?: unknown; webkitAudioContext?: unknown;
    SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown;
  };
  return formatVoiceDiagnostic(error, {
    secureContext: window.isSecureContext,
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    mediaRecorder: typeof MediaRecorder !== "undefined",
    audioContext: Boolean(browser.AudioContext ?? browser.webkitAudioContext),
    speechRecognition: Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition),
    microphonePermission,
  });
}