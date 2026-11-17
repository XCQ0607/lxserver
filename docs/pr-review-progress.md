# Bot review repair progress

## 2026-11-17 — aggregate-search review (#530, shared with #531)

- [x] Compare complete normalized singer sets; solo and duet recordings no longer merge.
- [x] Default quality selection recognises hires/flac24bit aliases in both directions.
- [x] Automatic platform fallback attempts alternatives excluded by the requested-quality filter, even with quality degradation disabled.
- [x] Track actual candidate attempts; pass failed platforms to the owning playback recovery only, without altering prefetch/download state.
- [x] Regression tests: 13 song-merge/resolution tests pass; TypeScript no-emit, JavaScript syntax and diff checks pass.
- [ ] Physical browser/audio qualification (not claimed by unit tests).

Full branch validation: 203 TypeScript tests and 288 CJS tests passed; CJS runner reports one pre-existing OpenList asynchronous teardown failure, also reproduced on unchanged #531 head. No live deployment performed.


## 2026-11-17 — follow-up bot review

- [x] Media recovery retains all merged members, including an untouched primary. Only actual resolution attempts are recorded; recovery retries a single member without re-entering its failed merged group.
- [x] Aggregate search reads the current lexical settings object, not the stale window snapshot; tested with disagreeing restored/global settings.
- [x] Supported-platform unions exclude per-script disabledSources while retaining support from other enabled scripts.
- [x] Merged candidate support lookup waits at most 3 seconds, then sorts with unknown support so cached playback/download can continue.
- Validation: 6/6 resolution/recovery tests and the merge/paged-search suites pass. Full CJS: 292 passed, one pre-existing OpenList teardown failure; no-emit compilation and diff checks passed.

These PR changes have not been deployed. The separate live marquee-only release is unchanged. The OpenList failure in #528/#530/#531 is the previously reproduced asynchronous teardown error, not a passing full-suite result.


## 2026-11-17 — OpenList CI failure repaired

The previously reported asynchronous OpenList teardown failure is now fixed. A pending metadata persistence timer outlived the test runtime; explicit flushing and runtime-root validation now prevent the late undefined-path exception. Both HTTP fixtures restore their previous global runtime. See `docs/openlist-ci-progress.md`.

Final integrated local validation: **292/292 CJS and 208/208 TypeScript tests passed**, and `npm run build --ignore-scripts` passed. No test suppression or added waiting sleeps; no deployment. Node 22/24 GitHub Actions results will be recorded in the PR follow-up.


## Additional bot review / cache-first synchronization

- [x] Pending metadata state is independent of the debounce timer. Successful persistence clears it; failed write/rename remains explicitly flushable, including without another observation. Both ENOSPC paths have regressions.
- [x] Synchronized the independent cache-first replay guard from #538 without waiting for source inventory or quality filtering; local cache preference and retry bypasses remain intact.
- [x] After all known merged members fail, recovery searches only untried platforms. Existing untried members are returned without waiting on a new network search.
- [x] Media-error retries map quality aliases for the selected playback platform, including optional-merge-module compatibility.
- [x] Added two real recovery/error-handler regressions; both failed before correction.

Validation: 309/309 CJS and 210/210 TypeScript tests passed; the production build and diff checks passed. No additional live deployment was made for this review pass.

- [x] Final #530 review: replacing a remote prefetch with cached audio clears old attempted-platform metadata in both merged and single-member paths. The miss path preserves the original result. Two replacement assertions failed before correction; full test/build validation above passed again.
