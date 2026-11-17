# Bot review repair progress

## 2026-11-17 — returned-URL review (#525)

- [x] Recognise definite AAC/Opus lossy URLs and codec MIME types; do not infer a codec from M4A, Ogg or WMA containers alone.
- [x] HEAD probes use Needle with the playback `music` proxy category and headers; redirect hops recompute the agent and share a deadline.
- [x] Handle 405/501 before inspecting error-page MIME types. Reject other failed HTTP statuses, including 429/500 without content-type.
- [x] Preserve the first valid lossy fallback, including when the last candidate is also lossy.
- [x] Return `type: lossy`, `requestedQuality`, and `isLossyDowngrade` when loss is detected; no bitrate is invented. Server resolution compares remaining platforms/allowed quality tiers before using that fallback.
- [x] Validation: all 49 CJS + 53 TypeScript tests passed; TypeScript no-emit and diff checks passed. Includes a local proxy-only-host transport test and server resolver regressions. Final focused rerun: 9 URL-quality tests passed.
- [ ] External CDN/physical playback qualification (not claimed by local tests).


## 2026-11-17 — follow-up bot review

- [x] Alternative provider search and URL resolution now share an 8-second budget after the original attempt. A retained lossy URL is returned on expiry; without a URL, resolution fails normally.
- [x] Shared source-match search promises are bounded to 5 seconds and timeout eviction checks entry identity; late results cannot replace newer cached matches.
- [x] HEAD probing uses one AbortController/timer across agent lookup, redirects and all request phases; expiry aborts the active Needle request and bounds the returned promise.
- Validation: 52/52 CJS tests and 55/55 TypeScript tests passed; no-emit compilation and diff checks passed. Regression cases include stalled search/URL resolution, cache retry/late results, cumulative probe phases and stuck agent lookup.

These PR changes have not been deployed. The separate live marquee-only release is unchanged. The OpenList failure in #528/#530/#531 is the previously reproduced asynchronous teardown error, not a passing full-suite result.


## 2026-11-17 — OpenList CI failure repaired

The previously reported asynchronous OpenList teardown failure is now fixed. A pending metadata persistence timer outlived the test runtime; explicit flushing and runtime-root validation now prevent the late undefined-path exception. Both HTTP fixtures restore their previous global runtime. See `docs/openlist-ci-progress.md`.

Final integrated local validation: **276/276 CJS and 217/217 TypeScript tests passed**, and `npm run build --ignore-scripts` passed. No test suppression or added waiting sleeps; no deployment. Node 22/24 GitHub Actions results will be recorded in the PR follow-up.
