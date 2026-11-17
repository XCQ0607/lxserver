# Bot review repair progress

## 2026-11-17 — aggregate-search review (#530, shared with #531)

- [x] Compare complete normalized singer sets; solo and duet recordings no longer merge.
- [x] Default quality selection recognises hires/flac24bit aliases in both directions.
- [x] Automatic platform fallback attempts alternatives excluded by the requested-quality filter, even with quality degradation disabled.
- [x] Track actual candidate attempts; pass failed platforms to the owning playback recovery only, without altering prefetch/download state.
- [x] Regression tests: 13 song-merge/resolution tests pass; TypeScript no-emit, JavaScript syntax and diff checks pass.
- [ ] Physical browser/audio qualification (not claimed by unit tests).
