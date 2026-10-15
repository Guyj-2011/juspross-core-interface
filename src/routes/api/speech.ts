import { createFileRoute } from "@tanstack/react-router";
import { requestSpeech } from "@/lib/juspross/speech-request.server";

export const Route = createFileRoute("/api/speech")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) {
          return Response.json({ message: "Solicitud de voz no autorizada." }, { status: 403 });
        }
        const input = await request.json().catch(() => null);
        if (!input || typeof input.text !== "string" || !input.text.trim() || input.text.length > 12000) {
          return Response.json({ message: "La voz necesita un texto de entre 1 y 12.000 caracteres." }, { status: 400 });
        }
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return Response.json({ message: "Falta configurar el servicio de voz." }, { status: 401 });
        // Internal route remains behind published-site access; only server code can edit this circuit.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: circuit, error: readError } = await supabaseAdmin
          .from("speech_gateway_state").select("blocked,status_code,message").eq("id", "speech").maybeSingle();
        if (readError) return Response.json({ message: "No se pudo comprobar la disponibilidad de la voz." }, { status: 503 });
        if (circuit?.blocked) return Response.json({ message: circuit.message }, { status: circuit.status_code });
        try {
          const upstream = await requestSpeech({
            baseURL: "https://ai.gateway.lovable.dev",
            apiKey: key,
            model: "google/gemini-3.1-flash-tts-preview",
            format: "gemini",
            voice: "Charon",
          },
          "Read only the passage below in Spanish. Voice: a refined, calm adult male AI butler with a subtle British elegance. Tone: dry, polite, quietly confident and slightly witty; warm but never emotional. Pace: smooth and unhurried, crisp consonants, gentle downward cadence at sentence ends, short natural pauses. Slightly deep, clean and close to the microphone. No robotic filter, no exaggerated bass, no theatrical acting. Do not read these directions.\n\nPASSAGE:\n" + input.text.trim(), false, request.signal);
          if (!upstream.ok) {
            const raw = await upstream.text();
            let message = raw;
            try { const error = JSON.parse(raw); message = error.message ?? error.error?.message ?? raw; } catch { /* preserve safe plain message */ }
            if (upstream.status === 402 || upstream.status === 403) {
              const { error } = await supabaseAdmin.from("speech_gateway_state").upsert({
                id: "speech", blocked: true, status_code: upstream.status, message,
                updated_at: new Date().toISOString(),
              });
              if (error) console.error("Could not persist speech circuit", error.code);
            }
            return Response.json({ message }, { status: upstream.status });
          }
          const headers = new Headers({
            "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
          });
          upstream.headers.forEach((value, name) => { if (name.toLowerCase().startsWith("x-lovable-aig-")) headers.set(name, value); });
          return new Response(upstream.body, { status: upstream.status, headers });
        } catch (error) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return Response.json({ message: "No se pudo conectar con el servicio de voz. Inténtalo de nuevo más tarde." }, { status: 502 });
        }
      },
    },
  },
});