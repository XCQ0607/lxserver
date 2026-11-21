# Duo landscape touch layout — 20 November 2026

## Scope

Keep the existing audio, queue, playlist, source permissions and account settings.
Only presentation and its regression tests change.

- [x] Reveal song row actions on hoverless or coarse-pointer devices, regardless of width. Fine-pointer hover and keyboard focus behavior remain intact.
- [x] At 640–1024px, landscape, at most 650px high and with a coarse pointer, place song information/actions beside transport controls. Keep all controls, the meter, safe-area padding and measured footer reservation. No fixed footer height or audio-node replacement.
- [x] Ten new tests fail against the preceding CSS; 42 focused renderer, layout and portrait-boundary checks pass after correction.
- [x] Chromium and WebKit pass 36 before/after viewport fixtures, real queue/playlist clicks without playback, last-row reachability and horizontal-overflow checks. At 951×584, the footer drops from 141px to 97px and the list grows from 202px to 246px. Portrait and mouse layouts retain their previous geometry. These are synthetic browser fixtures, not physical iPhone proof.
- [x] Release profile: 514 JavaScript + 306 TypeScript = 820 tests and production build pass. PR profile: 410 + 226 = 636 tests and production build pass.
- [x] Published the UI follow-up to existing PR #531, base dev. Node 22/24 checks pass for the code head `9b6f20e`; bot review remains separate.
- Deployment receipts belong to the private operational profile; this upstream contribution contains no backend, account, source-script or container-configuration changes.
