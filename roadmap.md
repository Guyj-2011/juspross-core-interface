# Visual changes
- [x] Increase mantle and core particle brightness without changing their extent.
- [x] Add slowly moving blue aurora curtains with red accents in the sky.
- [x] Verify the scene and apply required package update.
- [x] Distribute broad auroras across the entire upper sky, rather than a line or directional strip.
- [x] Add and verify the two-style aurora selector in Settings, without changing panel layout.
- [x] Add the verified distributed full-sky aurora as a third selectable style.

# Voice
- [x] Replace robotic speech with a natural, composed masculine voice in both modes and verify playback.
- [x] Revert to the original voice (Algieba, composed personal-assistant style) after the butler variant was rejected; verified audio playback.
## Gemma 4 local integration
- [x] OpenAI-compatible client for llama.cpp (ai.ts: testGemma/chatGemma)
- [x] aiProvider + gemmaEndpoint/gemmaModel in v2Store, persisted
- [x] Auto-detect on load: Gemma first, Qwen/Ollama fallback, backoff retries
- [x] Status indicator: Conectando / Conectado a Gemma / Gemma no disponible
- [ ] Typecheck + build + browser verification
## Gemini Live + Nemotron
- [x] Nemotron server-side chat (verified streaming reply)
- [x] Gemini Live voice button in V2 console (token, mic 16 kHz PCM, 24 kHz playback, transcripts, interrupt, cleanup)
- [x] Fix bun:test typecheck error
- [ ] Real spoken conversation test with a human microphone (headless browser only has a test tone)
## Local agent (open Spotify on Windows)
- [x] 127.0.0.1-only Node agent with pairing, Origin/Host checks, rate limit, fixed spotify: launch
- [x] Browser client + chat intent + Gemini Live tool + Settings "Equipo local"
- [ ] Real test on the user's Windows 11 PC (needs the user)

## Lado 2.0 local-equipment access
- [ ] Reuse Equipo local inside the visible AI settings popup and verify pairing, launch results, disconnect, and narrow-screen access.
