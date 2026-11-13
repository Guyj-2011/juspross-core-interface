/** Deterministic parsing: transport words inside a title are never commands. */
export type SpotifyCommand = { name: string; args: Record<string, unknown> };
export const SPOTIFY_SEARCH_LIMIT = 10;
export function normalizeMusic(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function trackMatches(
  name: string,
  artists: string[],
  title: string,
  artist: string,
): boolean {
  const baseTitle = name.replace(/\s*(?:\([^)]*\)|\[[^\]]*\]| - .+)\s*$/, "");
  const wanted = normalizeMusic(title);
  const artistKey = normalizeMusic(artist).replace(/ /g, "");
  return (
    (!wanted || normalizeMusic(name) === wanted || normalizeMusic(baseTitle) === wanted) &&
    (!artistKey || artists.some((a) => normalizeMusic(a).replace(/ /g, "") === artistKey))
  );
}
export function parseSpotifyCommands(task: string, intent = "auto"): SpotifyCommand[] | null {
  const clean = task
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/^(?:(?:oye|ahora|por favor|puedes|podr[ií]as)\s+)+/i, "")
    .replace(/^(?:abre|inicia|lanza)\s+spotify\s+y\s+/i, "");
  // Split only before explicit command verbs, not titles such as "X y Y".
  const parts = clean.split(
    /\s+(?:y|luego|despu[eé]s)\s+(?=(?:cambia|sube|baja|ajusta|pausa|reanuda|dale|ponle|siguiente|anterior|retrocede|avanza)\b)/i,
  );
  if (parts.length > 4) return null;
  const result: SpotifyCommand[] = [];
  for (const part of parts) {
    const raw = part.replace(/\s+(?:en spotify|por favor)$/i, "").trim();
    const v = normalizeMusic(raw);
    let command: SpotifyCommand | null = null;
    const transport: [RegExp, string][] = [
      [
        /^(?:ponle play(?: a la cancion(?: que ya esta)?)?|dale play(?: a la cancion)?|play(?: a la cancion)?|reanuda|reanudar|continua|continuar)(?: la reproduccion)?$/,
        "spotify_resume",
      ],
      [
        /^(?:pausa|pausar|deten|detener)(?: la reproduccion| spotify| la musica)?$/,
        "spotify_pause",
      ],
      [
        /^(?:siguiente|cambiala|cambia la cancion|cambia de cancion|cambia a la siguiente|cambia la cancion a la siguiente|cambia la pista a la siguiente|pasa a la siguiente|salta a la siguiente|avanza)(?: cancion| pista)?$/,
        "spotify_next",
      ],
      [/^(?:anterior|vuelve a la anterior|cambia a la anterior|cambia la cancion a la anterior|pon la cancion anterior|retrocede)(?: cancion| pista)?$/, "spotify_previous"],
    ];
    for (const [pattern, name] of transport) if (pattern.test(v)) command = { name, args: {} };
    if (
      /^(?:dos canciones atras|retrocede dos pistas|retrocede dos canciones|vuelve dos canciones atras)$/.test(
        v,
      )
    )
      command = { name: "spotify_previous", args: { count: 2 } };
    const volume = v.match(
      /^(?:sube|subelo|subele|baja|bajalo|bajale|ajusta|pon|ponlo|dejalo|aumenta|disminuye)\s+(?:(?:el )?volumen\s+)?(?:al|a|en|hasta)\s+(\d{1,3})(?: por ciento)?$/,
    );
    if (volume) {
      const target = Number(volume[1]);
      if (target > 100) return null;
      command = { name: "spotify_volume", args: { target } };
    } else if (/^(?:sube|baja|aumenta|disminuye) (?:el )?volumen$/.test(v))
      command = {
        name: "spotify_volume",
        args: { direction: /^(sube|aumenta)/.test(v) ? "up" : "down" },
      };
    if (
      /^(?:pon|ponme|reproduce|toca) (?:una? |la )?(?:cancion|musica|tema|rola)(?: aleatoria| popular)?$/.test(
        v,
      )
    )
      command = { name: "spotify_play_personalized", args: {} };
    if (/^(?:pon|ponme|reproduce) (?:una? )?(?:cancion|tema) de otro artista$/.test(v))
      command = { name: "spotify_play_personalized", args: { different_artist: true } };
    if (intent === "current_artist") command = { name: "spotify_play_current_artist", args: {} };
    if (!command) {
      const artist = raw.match(
        /^(?:pon(?:me|gas)?|reproduce|toca|quiero escuchar)\s+(?:(?:una? |la |el )?(?:m[uú]sica|canciones|temas|canci[oó]n|tema|algo)\s+(?:de|del)\s+(?:el\s+)?(?:artista\s+)?)?(.+)$/i,
      );
      if (artist?.[1]) {
        let target = artist[1].replace(/^["“]+|["”]+$/g, "").trim();
        const artistOnly =
          /^(?:pon(?:me|gas)?|reproduce|toca|quiero escuchar)\s+(?:una? |la |el )?(?:m[uú]sica|canciones|temas|canci[oó]n|tema|algo)\s+(?:de|del)\s+/i.test(
            raw,
          ) || intent === "artist";
        if (artistOnly) {
          if (/^views$/i.test(target)) target = "VIUS";
          command = {
            name: "spotify_search_and_play",
            args: { query: `artist:${target}`, kind: "track" },
          };
        } else {
          target = target.replace(/^(?:la |una? )?(?:canci[oó]n|tema|rola)\s+/i, "");
          const split = target.toLocaleLowerCase("es").lastIndexOf(" de ");
          command = {
            name: "spotify_search_and_play",
            args: {
              query:
                split > 0
                  ? `track:${target.slice(0, split)} artist:${target.slice(split + 4)}`
                  : `track:${target}`,
              kind: "track",
            },
          };
        }
      }
    }
    if (!command) return null; // Ambiguous compound requests execute nothing.
    if (
      !result.some(
        (c) => c.name === command.name && JSON.stringify(c.args) === JSON.stringify(command.args),
      )
    )
      result.push(command);
  }
  return result.length ? result : null;
}

export type CommandResult = {
  ok: boolean;
  confirmed?: boolean;
  message: string;
  setCookie?: string | undefined;
};
export async function runSpotifyCommands(
  commands: SpotifyCommand[],
  execute: (command: SpotifyCommand) => Promise<CommandResult>,
) {
  const results: CommandResult[] = [];
  for (const command of commands) {
    const result = await execute(command);
    results.push(result);
    if (!result.ok || result.confirmed === false) break;
  }
  return {
    ok: results.length === commands.length && results.every((r) => r.ok && r.confirmed !== false),
    results,
  };
}
