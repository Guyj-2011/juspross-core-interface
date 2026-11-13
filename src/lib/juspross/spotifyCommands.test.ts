import { describe, expect, test } from "bun:test";
import { parseSpotifyCommands, runSpotifyCommands, trackMatches } from "./spotifyCommands";

describe("parseSpotifyCommands", () => {
  test("resumes the current song instead of searching for it", () => {
    expect(parseSpotifyCommands("ponle play a la canción que ya está")).toEqual([
      { name: "spotify_resume", args: {} },
    ]);
  });

  test("parses compound volume and next-track commands in order", () => {
    expect(parseSpotifyCommands("Ahora súbelo al 90% y cambia la canción a la siguiente")).toEqual([
      { name: "spotify_volume", args: { target: 90 } },
      { name: "spotify_next", args: {} },
    ]);
  });

  test("supports two previous tracks as one verified two-step operation", () => {
    expect(parseSpotifyCommands("dos canciones atrás")).toEqual([
      { name: "spotify_previous", args: { count: 2 } },
    ]);
  });

  test("treats a spoken artist request as an artist search", () => {
    expect(parseSpotifyCommands("pon una canción de Bad Bunny")).toEqual([
      { name: "spotify_search_and_play", args: { query: "artist:Bad Bunny", kind: "track" } },
    ]);
    expect(parseSpotifyCommands("pon Shakira", "artist")).toEqual([
      { name: "spotify_search_and_play", args: { query: "artist:Shakira", kind: "track" } },
    ]);
  });

  test("routes a same-artist follow-up to a dedicated playback action", () => {
    expect(parseSpotifyCommands("pon otra canción de este mismo artista", "current_artist")).toEqual([
      { name: "spotify_play_current_artist", args: {} },
    ]);
  });

  test("does not interpret a song title as a transport command", () => {
    expect(parseSpotifyCommands("pon la canción The Next Episode")).toEqual([
      { name: "spotify_search_and_play", args: { query: "track:The Next Episode", kind: "track" } },
    ]);
  });

  test("keeps ambiguous commands from triggering playback", () => {
    expect(parseSpotifyCommands("cambia la canción")).toBeNull();
  });
});

describe("Spotify search result matching", () => {
  test("normalizes accents and punctuation in artist names", () => {
    expect(trackMatches("Hips Don't Lie", ["Shakira"], "Hips Don't Lie", "Shakira")).toBe(true);
    expect(trackMatches("Thunderstruck", ["AC/DC"], "Thunderstruck", "AC/DC")).toBe(true);
  });

  test("accepts official subtitle variants without accepting unrelated tracks", () => {
    expect(trackMatches("Waka Waka (This Time for Africa)", ["Shakira"], "Waka Waka", "Shakira")).toBe(true);
    expect(trackMatches("Waka Waka Remix", ["Other Artist"], "Waka Waka", "Shakira")).toBe(false);
  });
});

describe("runSpotifyCommands", () => {
  test("executes actions sequentially and stops after the first failure", async () => {
    const order: string[] = [];
    const commands = [
      { name: "spotify_volume", args: { target: 90 } },
      { name: "spotify_next", args: {} },
    ];
    const result = await runSpotifyCommands(commands, async (command) => {
      order.push(command.name);
      return command.name === "spotify_volume"
        ? { ok: true, message: "Volumen confirmado." }
        : { ok: false, message: "No hay dispositivo." };
    });
    expect(order).toEqual(["spotify_volume", "spotify_next"]);
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(2);
  });

  test("does not run later actions after an unconfirmed result", async () => {
    const order: string[] = [];
    const result = await runSpotifyCommands(
      [
        { name: "spotify_volume", args: { target: 90 } },
        { name: "spotify_next", args: {} },
      ],
      async (command) => {
        order.push(command.name);
        return { ok: false, confirmed: false, message: "Estado incierto." };
      },
    );
    expect(order).toEqual(["spotify_volume"]);
    expect(result.ok).toBe(false);
  });
});
