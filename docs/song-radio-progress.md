# Song radio across song menus

Radio starts the captured selected song and continuously adds related tracks using the existing similar-song endpoint. This is Spotify/TIDAL-like song-radio behavior, not a claim to reproduce either proprietary recommendation algorithm. Ordinary Play and saved auto-radio/playback-mode settings remain unchanged.

Covered surfaces: song search, saved lists/favorites, artist tracks, album tracks, playlist detail, charts, playback queue, local/cache music and custom directories. Local playback retains its authorized file route; recommendation queries contain metadata and supported provider IDs, not local paths, filenames or private media credentials. Queue and radio menu actions have distinct decorative icons.

Refills deduplicate already-seen playable IDs, respect Play Next, remain bounded, reject stale pause/new-view responses and serialize duplicate end events. Only station-owned already-played history is pruned near the existing queue limit; manual entries remain intact. Empty/error responses terminate that station rather than retrying in a loop.

## Verification

362 CJS + 256 TypeScript tests and production build pass. Native Chromium/WebKit fixtures cover nine song-menu surfaces across five desktop/mobile viewports per engine. The baseline UI may require its existing compact-header control on very short playlist screens; the separate UI PR fixes the full mobile playlist scroll/layout. No physical-device, audible output or recommendation-quality equivalence claim.
