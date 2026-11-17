# Completed audio cache before source resolution

Replay first checks completed local audio for every persisted/merged platform member. This phase does not load source-support inventory or resolve a provider URL. It prefers the requested cached tier, then the highest cached fallback; explicit local files, cache opt-out, exact retries and cache-bypass downloads retain their existing behavior.

The optional aggregation API is not required: saved enriched songs remain playable on current `dev`. The same guard is synchronized into the aggregate-search/UI branches, where it runs before provider capability filtering. Remote prefetches are rechecked across all members. `hires` and `flac24bit` are one cache-upgrade tier; genuine upgrades stay asynchronous.

Browser URL caching only remembers a remote URL and cannot substitute for a completed audio file. Lyrics, artwork and optional upgrades can still make independent network requests.

## Validation

- Current-dev baseline failed 9 of 15 new cached-replay regressions; the repaired branch passes all 15.
- 290 CJS tests and 208 TypeScript tests passed; `npm run build --ignore-scripts` passed.
- Includes the OpenList fixture teardown prerequisite and retryable metadata flush correction so CI does not retain an asynchronous undefined-path failure or lose a pending save after a write error.
- Tests use production-function seams and isolated HTTP/filesystem fixtures. No physical-device playback qualification is claimed.

Cached-media error retries normalize the selected platform quality name even when the optional aggregation module is absent. The same handler seam is covered with and without the merge API.

When a remote prefetch is replaced by completed local audio, its old `triedPlatforms` are discarded. Cache misses retain the original prefetch result unchanged. Both merged and single-member replacement paths have regressions with populated attempted-platform metadata.
