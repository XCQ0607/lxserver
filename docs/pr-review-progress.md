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

## 2026-11-17 — UI/language review (#531)

- [x] Preserve non-loading error/status messages while leaving normal playback status quiet.
- [x] Cancel pending recommendation continuation on device disconnect and logout; keep natural endings/internal source transitions separate.
- [x] Restrict phone search-row layout to below 640px and isolate mini-player keyboard activation from child controls.
- [x] Suggestion selection validates primary button, pointer identity, movement and pressed item identity; rejected releases also suppress compatibility clicks.
- [x] Resync custom dropdowns after native-option translation. Commit language/store/controls only after resources load; retain old language on failure, show retry feedback, and guard stale requests.
- [x] 14 UI/language regressions pass. Shared recommendation, merge and resolution regressions pass. Stalled JSON body abort verified with a local HTTP fixture.
- [ ] Physical touch/receiver playback verification (not performed).

Full branch validation before the final timeout test: 218 TypeScript tests and 317 CJS tests passed; CJS runner reports one pre-existing OpenList asynchronous teardown failure. The identical failure was reproduced on unchanged head fcf9ca3. No live deployment performed.
