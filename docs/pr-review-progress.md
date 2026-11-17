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


## 2026-11-17 — follow-up bot review

- [x] Mini-player Enter/Space expansion now stops propagation after handling the parent key event; child controls remain untouched and Space cannot also toggle playback through the global shortcut.
- [x] Synchronized #528 browser recommendation timeout/qualified queue identity and #530 full-member recovery/current settings/disabled-source union/bounded support lookup fixes.
- Validation: 54/54 focused UI/recommendation/merge/paged-search tests pass. Full CJS: 324 passed, one pre-existing OpenList teardown failure; no-emit compilation and diff checks passed.

These PR changes have not been deployed. The separate live marquee-only release is unchanged. The OpenList failure in #528/#530/#531 is the previously reproduced asynchronous teardown error, not a passing full-suite result.


## 2026-11-17 — OpenList CI failure repaired

The previously reported asynchronous OpenList teardown failure is now fixed. A pending metadata persistence timer outlived the test runtime; explicit flushing and runtime-root validation now prevent the late undefined-path exception. Both HTTP fixtures restore their previous global runtime. See `docs/openlist-ci-progress.md`.

Final integrated local validation: **324/324 CJS and 224/224 TypeScript tests passed**, and `npm run build --ignore-scripts` passed. No test suppression or added waiting sleeps; no deployment. Node 22/24 GitHub Actions results will be recorded in the PR follow-up.


## Additional bot review / cache-first synchronization

- [x] Pending metadata state is independent of the debounce timer. Successful persistence clears it; failed write/rename remains explicitly flushable, including without another observation. Both ENOSPC paths have regressions.
- [x] Synchronized the independent cache-first replay guard from #538 without waiting for source inventory or quality filtering; local cache preference and retry bypasses remain intact.
- [x] After all known merged members fail, recovery searches only untried platforms. Existing untried members are returned without waiting on a new network search.
- [x] Media-error retries map quality aliases for the selected playback platform, including optional-merge-module compatibility.
- [x] Added two real recovery/error-handler regressions; both failed before correction.

Validation: 341/341 CJS and 226/226 TypeScript tests passed; the production build and diff checks passed. No additional live deployment was made for this review pass.
