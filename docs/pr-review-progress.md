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

## Fresh review follow-up — 19 November 2026

The completed fresh review posted 15 additional inline findings, one outside-diff progress-event finding, and one test nitpick. All were verified and addressed:

- [x] Invalid alternates no longer poison the primary batch. The actual resolved prefetch identity is prioritized on handoff, deduplicated and kept within the eight-member limit; server recording-validation rules are not relaxed.
- [x] Quality degradation can find newly completed local bytes at the exact next tier, retaining failed-file exclusions. Local prepared replacements do not overwrite the original online request quality.
- [x] Preloaded-but-paused media can recover once the user requests playback; paused preload failures do not auto-start. Stall, native error and play rejection use the same recovery claim. Authentication rejection has an independent visible notification, and stale SSE progress cannot update the current song.
- [x] Truncated recording buckets are explicitly marked so hidden provider IDs cannot make an ambiguous recording look unique. Exact known-ID selection remains available.
- [x] 256-kbps captures are never labeled 320k; actual 320-kbps captures retain their tier. Publication can atomically repair a missing/empty/truncated same-key cache index entry without deleting or overwriting existing media; usable entries remain protected.
- [x] Windows issuance/publication is disabled until private ACL verification is supported; POSIX permission checks remain. Both language guides explain this platform restriction and readiness warm-up.
- [x] Offers retain bounded native IDs in metadata without changing the normalized playback identity; QQ offers require a valid string `strMediaMid`. No usable offer is returned until its spool directory has completed preparation. Pending preparation is coalesced and bounded.
- [x] Finalization has a separate ten-second budget. Its scoped abort signal invalidates late publication before commit; active capture reservations are token-owned. At most two unsettled publication/cleanup reservations can remain, including failed unlinks. Normal media delivery never waits for this work.
- [x] Split disk-open failure from buffer-overrun tests, assert subsequent slot reuse, and use finite 64-MiB admission input to test the internal 32-MiB ceiling. Added timeout/late-publish/failed-unlink bounds tests.

Final local verification: **294 CJS + 242 TypeScript = 536 passing**, zero failures/cancellations; one Windows-only rejection test is intentionally skipped on macOS. Full production build, no-emit compilation, JavaScript syntax and diff checks passed. A clean archive of the previous PR head reproduced eight new frontend regressions and five backend admission/publication/ambiguity regressions before these fixes. GitHub Node 22/24 passed for the first fix commit; the new follow-up head requires its own CI run. No deployment was performed.
