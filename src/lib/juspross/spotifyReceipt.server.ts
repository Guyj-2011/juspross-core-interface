import { readSpotifySession } from "./spotify.server";

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A claim is never released on timeout: Spotify cannot guarantee exactly-once writes. */
export async function claimSpotifyCommand(request: Request, requestId: string, commands: unknown) {
  const read = await readSpotifySession(request);
  if (!read.session) throw new Error("Spotify no está conectado. Conecta la cuenta desde Ajustes.");
  const sessionHash = await hash(read.session.refresh_token);
  const commandHash = await hash(JSON.stringify(commands));
  // Privileged storage only after verifying the encrypted, server-issued Spotify session.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const inserted = await supabaseAdmin.from("spotify_command_receipts").insert({ session_hash: sessionHash, request_id: requestId, command_hash: commandHash });
  if (inserted.error && inserted.error.code !== "23505") throw new Error("No pude registrar la orden de forma segura; no ejecuté ninguna acción.");
  if (inserted.error) {
    const previous = await supabaseAdmin.from("spotify_command_receipts").select("command_hash,outcome").eq("session_hash", sessionHash).eq("request_id", requestId).single();
    if (previous.error || previous.data.command_hash !== commandHash) throw new Error("Identificador de orden reutilizado para una petición distinta.");
    return { duplicate: true as const, outcome: previous.data.outcome, setCookie: read.setCookie };
  }
  return {
    duplicate: false as const,
    setCookie: read.setCookie,
    complete: async (outcome: Record<string, unknown>) => {
      const saved = await supabaseAdmin.from("spotify_command_receipts").update({ outcome }).eq("session_hash", sessionHash).eq("request_id", requestId);
      if (saved.error) throw new Error("La orden pudo ejecutarse, pero no pude guardar su confirmación. No la repetiré.");
    },
  };
}