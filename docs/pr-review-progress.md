# PR bot review progress — 19 November 2026

Scope: open upstream `dev` PRs #525, #528, #530, #531, #538 and #539. Existing local main-checkout edits and live deployments are not part of this review pass.

## PR #539 — continuity-first playback

- [x] A cache lookup whose token renewal outlives its lookup budget returns a cache miss, not the obsolete first response's 401. A completed auth denial (401/403) remains terminal; renewal within budget retries with the same account.
- [x] A fresh cached-media URL refresh or same-platform retry returning `NO_AVAILABLE_SOURCE` immediately ends recovery, clears pending auto-skip and reports the configuration issue. Ordinary media errors retain normal fallback.
- [x] Read-through publication rejects non-string/over-2048-character artwork and native IDs over 512 characters before creating a final link or mutating its index. Reject the entire offer rather than dropping identity fields. Boundary-valid values are preserved.
- [x] English and Chinese pilot docs state the per-user 128-file / 256-MiB caps, counting reserved orphan files, and the requirement that `user.enableCacheSizeLimit` be disabled.
- [x] Candidate file containment and stat checks use asynchronous filesystem calls; selection and its route await verification. Lexical/symlink containment, eligibility, ordering and exclusion rules remain tested. This does not claim that all metadata-index I/O is asynchronous.
- [x] Existing include-OpenList-only test explicitly checks local-before-cloud order for both local hit and miss; route-extraction markers are asserted before slicing.
- [x] Integrated existing reviewed OpenList fixes (`556f7e3`, `fcf71e9`) after the full suite reproduced the known deferred-writer teardown exception. No tests were disabled.

## Verification

- The cache-auth timeout, recovery fall-through and malformed-publication regressions failed before their fixes and passed afterward.
- Full local run on Node 26.13.1: **286 CJS + 234 TypeScript = 520 tests passed**, zero failures, skips or cancellations.
- Production compilation: `npm run build --ignore-scripts` passed; syntax and `git diff --check` passed.
- The installed local Node 22 executable cannot launch because its Homebrew simdjson dependency is missing. Node 22/24 qualification is left to the PR's GitHub Actions matrix; local Node 26 results are not a substitute.
- No Synology deployment, provider calls, account/configuration changes or user-data migration.

## Other open PRs

At inspection, #525, #528, #530, #531 and #538 had no unresolved inline review threads. Their previously reported outside-diff findings are covered by existing fixes, regression tests and PR replies. #538's bot summary reports a review allowance limit, not approval; no new findings were produced by that skipped run. Do not report it as a clean bot review.
