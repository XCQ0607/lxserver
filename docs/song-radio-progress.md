# Song radio across song menus

Radio starts the captured selected song and continuously adds related tracks using the existing similar-song endpoint. This is Spotify/TIDAL-like song-radio behavior, not a claim to reproduce either proprietary recommendation algorithm. Ordinary Play and saved auto-radio/playback-mode settings remain unchanged.

Covered surfaces: song search, saved lists/favorites, artist tracks, album tracks, playlist detail, charts, playback queue, local/cache music and custom directories. Local playback retains its authorized file route; recommendation queries contain metadata and supported provider IDs, not local paths, filenames or private media credentials. Queue and radio menu actions have distinct decorative icons.

Start Radio updates the real playback queue without opening its drawer or changing saved playlists. An open drawer updates in place. While the explicit station is active, refill toward 24 distinct upcoming recommendations, excluding the seed, played history and manual Play Next entries. Publish eligible results on arrival and use buffered candidates before another bounded related-song lookup. Thin provider results remain visibly below target; no duplicates or unrelated filler are used.

Refills respect Play Next, reject stale pause/new-view responses and serialize duplicate end events. Only station-owned already-played history is pruned near the existing queue limit; manual entries remain intact. An empty station falls back to the regular queue rather than retrying in a loop.

## Verification

373 CJS + 262 TypeScript tests and production build pass. Native Chromium/WebKit fixtures cover nine song-menu surfaces across five desktop/mobile viewports per engine. The baseline UI may require its existing compact-header control on very short playlist screens; the separate UI PR fixes the full mobile playlist scroll/layout. No physical-device, audible output or recommendation-quality equivalence claim.

Twelve additional native radio cases cover a closed, open or dismissed drawer, partial results reaching 24 real tracks, and no-fetch replenishment from buffered tracks. Fixtures use controlled sources rather than production providers.
