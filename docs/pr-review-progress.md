# Bot review repair progress

## 2026-11-17 — search-radio review (#528, shared with #530/#531)

- [x] Verified recommendation `_searchRadio` markers already persist; added a real save/JSON/restore queue regression and persisted explicit play-next markers too.
- [x] Device disconnect cancels pending recommendation continuation before pausing.
- [x] Bound YouTube Music and QQ recommendation JSON body reads; streaming defaults unchanged.
- [x] Preserve legitimate titles ending in Live; explicit version annotations remain filtered.
- [x] Cache identities include provider/seed ID, with text fallback only when IDs are absent.
- [x] Validation: 15 queue tests, 15 recommendation tests, TypeScript no-emit and diff checks pass.
- [ ] Physical device pause/playback qualification (not claimed by these tests).

## 2026-11-17 — aggregate-search review (#530, shared with #531)

- [x] Compare complete normalized singer sets; solo and duet recordings no longer merge.
- [x] Default quality selection recognises hires/flac24bit aliases in both directions.
- [x] Automatic platform fallback attempts alternatives excluded by the requested-quality filter, even with quality degradation disabled.
- [x] Track actual candidate attempts; pass failed platforms to the owning playback recovery only, without altering prefetch/download state.
- [x] Regression tests: 13 song-merge/resolution tests pass; TypeScript no-emit, JavaScript syntax and diff checks pass.
- [ ] Physical browser/audio qualification (not claimed by unit tests).
