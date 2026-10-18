<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep both aurora styles in a dedicated procedural Three.js environment layer with CSS palette tokens, independent reduced-motion-aware timing and opacity crossfades; switch styles without rebuilding the scene so the core and voice remain unaffected.
- Both modes use the shared cancellable neural speech player through the internal speech server route; meter actual PCM audio for core amplitude and surface errors without automatic browser-voice fallback to preserve the intended voice quality.
- Persist speech gateway credit/policy and provider-denial circuits in the server-only speech_gateway_state table; only an explicit owner recovery may clear a block after access is restored, preventing reloads from replaying denied requests.
- Keep browser voice capability collection and diagnostic formatting in a browser-only utility called on demand; this avoids permission queries during SSR and keeps copied diagnostics consistent.
