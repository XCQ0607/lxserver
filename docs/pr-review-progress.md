# Bot review repair progress

## 2026-11-17 — returned-URL review (#525)

- [x] Recognise definite AAC/Opus lossy URLs and codec MIME types; do not infer a codec from M4A, Ogg or WMA containers alone.
- [x] HEAD probes use Needle with the playback `music` proxy category and headers; redirect hops recompute the agent and share a deadline.
- [x] Handle 405/501 before inspecting error-page MIME types. Reject other failed HTTP statuses, including 429/500 without content-type.
- [x] Preserve the first valid lossy fallback, including when the last candidate is also lossy.
- [x] Return `type: lossy`, `requestedQuality`, and `isLossyDowngrade` when loss is detected; no bitrate is invented. Server resolution compares remaining platforms/allowed quality tiers before using that fallback.
- [x] Validation: all 49 CJS + 53 TypeScript tests passed; TypeScript no-emit and diff checks passed. Includes a local proxy-only-host transport test and server resolver regressions. Final focused rerun: 9 URL-quality tests passed.
- [ ] External CDN/physical playback qualification (not claimed by local tests).
