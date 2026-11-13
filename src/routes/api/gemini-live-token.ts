import { createFileRoute } from "@tanstack/react-router";
import { GEMINI_LIVE_MODEL, GEMINI_LIVE_VOICE, GEMINI_LIVE_SYSTEM } from "@/lib/juspross/geminiLiveConfig";

/**
 * Emite un token efímero de un solo uso para Gemini Live. GEMINI_API_KEY nunca sale
 * del servidor; la configuración (modelo, voz, instrucciones) queda bloqueada en el token.
 */
export const Route = createFileRoute("/api/gemini-live-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
          return Response.json({ message: "Solicitud no autorizada." }, { status: 403 });
        const key = process.env["GEMINI_API_KEY"];
        if (!key) return Response.json({ message: "Falta configurar GEMINI_API_KEY en los secretos del proyecto." }, { status: 500 });
        const now = Date.now();
        try {
          const res = await fetch("https://generativelanguage.googleapis.com/v1alpha/auth_tokens", {
            method: "POST",
            signal: AbortSignal.timeout(15_000),
            headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
            body: JSON.stringify({
              uses: 1,
              expireTime: new Date(now + 30 * 60_000).toISOString(),
              newSessionExpireTime: new Date(now + 60_000).toISOString(),
              bidiGenerateContentSetup: {
                model: GEMINI_LIVE_MODEL,
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_LIVE_VOICE } } },
                },
                systemInstruction: { parts: [{ text: GEMINI_LIVE_SYSTEM }] },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                tools: [{
                  functionDeclarations: [{
                    name: "delegate_to_nemotron",
                    description: "Delegar a Nemotron tareas de razonamiento y acciones de Spotify. Úsala cuando el usuario pida reproducir música, pausar, reanudar o cambiar canciones, así como para tareas complejas. Nemotron puede ejecutar las herramientas de Spotify autorizadas y devolver el resultado real.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        task: { type: "STRING", description: "La tarea concreta que debe analizar Nemotron." },
                        context: { type: "STRING", description: "Contexto relevante de la conversación y preferencias del usuario." }
                      },
                      required: ["task"]
                    }
                  }, {
                    name: "open_spotify_desktop",
                    description: "Abre la aplicación de escritorio de Spotify en el PC Windows del usuario mediante el agente local de Juspross. Úsala solo cuando pida abrir/iniciar la app. No reproduce ni controla música. Comunica exactamente el resultado devuelto.",
                    parameters: { type: "OBJECT", properties: {} }
                  }, {
                    name: "inspect_shared_screen",
                    description: "Analiza el fotograma actual de toda la pantalla principal del usuario. Úsala cuando el usuario pregunte qué aparece en pantalla, qué canción o aplicación se ve, o pida que mires su escritorio. Solo úsala como respuesta a una petición explícita del usuario.",
                    parameters: { type: "OBJECT", properties: {} }
                  }]
                }]
              },
            }),
          });
          const j = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
          if (!res.ok || !j.name) {
            const status = res.status === 401 || res.status === 403 ? 502 : res.status || 502;
            return Response.json(
              { message: `Google no emitió el token de Gemini Live (${res.status}). ${j.error?.message?.slice(0, 200) ?? ""}`.trim() },
              { status },
            );
          }
          return Response.json(
            { token: j.name, model: GEMINI_LIVE_MODEL },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json({ message: "No se pudo contactar con Google para iniciar Gemini Live." }, { status: 504 });
        }
      },
    },
  },
});
