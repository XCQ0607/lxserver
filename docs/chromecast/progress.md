# Chromecast progress

## Complete customization submission and version identity — 2026-10-20

### Expanded review before deployment

- [x] Final thread audit found three older unresolved findings: unescaped playlist metadata/click arguments, account Tokens retaining a guest media cookie, and Cast quotas using unvalidated cookie IDs. Reproduced nine cases against `6a48885` and corrected them. Existing Token/login paths now bind the matching account cookie before media; account verification promotes guest/other-account sessions; playlist row/grid templates escape remote metadata and safely encode click arguments; Cast ownership accepts only live stored sessions.
- [x] Follow-up passes all159tests (147CJS+12TS), type/build/JS/diff and53 compiled-server HTTP checks, including actual guest-to-account cookie promotion and private media reads. Follow-up fingerprint `9925f04`, worker51.
- [x] Deploy follow-up `4ebc5bc` over the verified prior image: 53 isolated NAS/52 safe live HTTP checks, 264 file hashes, 12 session/10 effects/5 login regressions per image, eleven authenticated HTTPS assets and five initialized sources pass. Six existing files updated/258 preserved; configuration/environment/six mounts and all51other containers unchanged. Protected stopped-state rollback evidence retained; candidate/clone removed. Current deployment is worker51/build `9925f04`, superseding the first successful worker50 deployment below. The six corrected review threads are resolved; official merge remains separate.

- [x] Reproduce token-only cookie recovery failure, loss of a valid Token without a saved password, touch-desktop resize loss of DSP control, and missing player-password login/restore behavior.
- [x] Restore a native media cookie through the existing Token-authenticated verification endpoint before considering password renewal; retain Token-only credentials. Keep an already established desktop effects graph controllable after resize while still yielding to AirPlay/Cast. Restore explicit account/player-password login modes, mode-aware persistence and automatic recovery without a username for guests.
- [x] Pass all 149 tests (137 CJS + 12 TypeScript), type/build/JS/diff checks and 50 isolated compiled-server HTTP checks. Repin version `v2.1.3`, fingerprint `93301ce`, worker v50; the earlier v49 artifact is superseded before deployment.

- [x] Include all remaining tracked customizations in the official submission while preserving the user's earlier commit history: VU themes/geometry/stereo routing, native/pass-through audio policy, compact login, search compatibility, quality badges, foreground preload retry and the combined conflict fixes.
- [x] Include the subsequent QQ/Safari MIME normalization, mobile/wireless effects guards, playback-session recovery, credential-log removal and closed-drawer animation optimization.
- [x] Replace fabricated Player/About/runtime-config v1.0.0 fallbacks. Read the running package version, synchronize generated version metadata at build/start, and show the source fingerprint beside the Player version. About uses the same metadata.
- [x] Add regressions for stale/missing metadata, reproducible build identities, source/version changes, matching Player/About labels and escaped About substitutions; refresh worker v49.
- [x] Pass all 141 tests (129 CJS + 12 TypeScript), TypeScript checking, production compilation, JS syntax and diff checks. The compiled server passes 48 isolated HTTP checks using disposable account/data/configuration, including version/fingerprint agreement, login, media ranges and Cast access. No configured external provider or physical receiver was used in this run.
- [x] Update official PR #451 with the complete profile, original customization history and current results; code checkpoint `f3535de`. The expanded PR contains 59 changed files. Its new automated review is pending and is separate from the previously resolved review threads.
- [x] Prepare a pinned six-file release overlay plus full before/after manifests, verification scripts and rollback handoff; schedule a quiet 30-minute connectivity retry that stops after verified deployment.
- [x] Deploy reviewed code `6a48885`, fingerprint `93301ce`, worker v50 after connectivity returned. All 263 pre-deployment hashes matched; the isolated NAS candidate passed 50 HTTP checks, all 264 resulting hashes, 12 session/10 effects/4 login regressions and initialization of all five sources. Back up current data/configuration and recreate only LX; live verification passed 49 safe HTTP checks, the same hashes/regressions, eleven authenticated HTTPS assets and five initialized sources. Configuration bytes, environment, six mounts and all 51 unrelated containers were preserved; the candidate/clone were removed and rollback evidence retained. No new physical receiver, Windows or iPhone test is claimed.

The dated sections below record earlier verification and the historical separation of public/custom profiles. This submission combines them; earlier hardware results are not a fresh physical receiver test of the new build. The user's pre-existing customizations retain their original commits and attribution.

- [x] Review existing playback, authentication and Google Web Sender integration.
- [x] Implement mobile-accessible Cast controls, remote transport and local handoff.
- [x] Implement expiring resource capabilities without sharing general login credentials.
- [x] Preserve native Safari/AirPlay and existing player behavior.
- [x] Keep transport centered with equal side columns; group speed and wireless controls on the right.
- [x] Integrate on the latest upstream `dev`, retaining its HTTP cookie, metadata, playback recovery and synchronization fixes.
- [x] Prevent local crossfade from modifying Cast volume, including fades already running during handoff.
- [x] Pass 76 automated checks, TypeScript checking and production compilation.
- [x] Start the compiled server with isolated temporary data; verify HTTP cookie login, authenticated player markup, Cast assets and worker version.

An earlier compatible deployment passed 35 isolated/live runtime checks, 30 existing metadata/artwork checks and release asset verification. Desktop Chrome and an Onkyo TX-RZ50 accepted MP3 and reported advancing playback, pause, seek and disconnect; local audio stayed paused while casting. Responsive controls were checked at desktop and 320px widths with zero center offset and no control overlap. These hardware/layout checks describe that deployed version; the latest upstream integration has automated and isolated-startup coverage, not another physical receiver run.

Live validation also reproduced and fixed playlist-category escaping-helper shadowing and a batch-module export referring to a function defined by a later script. Regression tests cover both startup/rendering failures.

Physical Android, other receiver/codec combinations, independent audible monitoring and iOS lock-screen/DSP transitions remain separate manual checks.

## Combined deployment profile

- [x] Merge the upstream integration with the existing customization branch, preserving the custom stereo VU themes, search response compatibility, quality badges, pass-through volume policy and transient preload retry behavior.
- [x] Retain lyric-title, composite artist and raster artwork behavior; include the 30 existing metadata regressions in the combined suite.
- [x] Pass all 82 tests, including saved pass-through settings and transient preload retry regressions; refresh the combined frontend worker to v42.
- [x] Validate and deploy the combined release: 38 isolated and 38 live runtime checks; 179 release file hashes and 84 retained static asset hashes match; five sources initialize successfully.
- [x] Verify signed-in HTTPS assets, secure cookies and centered desktop/320px controls; configuration bytes, six mounts and 51 unrelated containers remain unchanged.

The existing customization history includes eleven commits from October 12–13, before the October 19 audit, covering VU themes, audio behavior, search compatibility and badges. These are retained from the user's fork. Commit author identities alone do not distinguish manual work from assistant-generated work.

## Combined-code compatibility audit

- [x] Reproduce and fix nine behavioral conflicts across fixed audio policies, automatic login, sync surfaces, Cast/recovery handoff and custom VU rendering.
- [x] Pass all 91 tests, type checking and production compilation; retain the existing lyric/artwork, security and playback regressions.
- [x] Deploy code `6cafc09`: 41 isolated and 41 live runtime checks pass, seven changed and 256 preserved file hashes match, all five sources initialize, and signed-in HTTPS/browser checks pass. Configuration, six mounts and 51 unrelated containers remain unchanged.
- [x] Port the four shared Cast/recovery/sync corrections to upstream PR #451 (`abd404a`), with all 54 tests and type checks passing.

The compatibility audit (`combined-conflict-audit.md`, not included in this documentation tree) records reproductions, fixes and validation limits. Frontend worker v43 refreshes the corrected assets.

- [x] Follow-up compatibility audit: retain seeks during pending Cast LOAD, reject stale local-recovery timers after route changes, and synchronize unique sync-status views with the correct initiating connection form. Four focused regressions cover these shared fixes.


## PR review follow-up

- [x] Verify both automated review batches against the current source; address all twelve distinct findings.
- [x] Preserve standard/scoped artwork, pending play intent, lyric speed and resumed Cast sessions.
- [x] Save local EQ/preset/reverb/pitch/panner settings during wireless playback without capturing native audio.
- [x] Remove generated reusable account tokens from native media/artwork/download URLs; validate read-only account-cookie access and rejection of guest/expired/deleted sessions.
- [x] Reject empty administrator secrets, revoke credentials before user-space rename/migration, escape playlist statistics/errors, and use a Windows-compatible directory-link fixture.
- [x] Isolate shared-download cancellation and retry unaffected callers; serialize differing lyric/provenance requirements and use separate temporary paths for retries.
- [x] Limit proxy timeout to response headers and terminate downstream output on request/response failure or upstream abort.
- [x] Pass all 76 tests, type checking and production compilation; refresh first-party assets with worker v44.
- [x] Start the corrected compiled application with disposable data: ten isolated checks pass for login/cookie flags, authenticated player/worker and cookie-only private media authorization. Historical source replay reproduces twenty failures across 59 focused tests; the corrected suite passes.


## Reviewed fixes in the customized deployment

- [x] Merge PR review corrections through `2e833cf` with the custom audio/login/VU profile, retaining the previous nine compatibility corrections.
- [x] Pass all 116 combined tests (104 CJS + 12 TypeScript), type checking and production compilation.
- [x] Validate the isolated image: 45 runtime checks, all five sources initialized, 11 updated and 252 retained file hashes match.
- [x] Back up and deploy code `fc98ffc`: 45 live checks and ten authenticated HTTPS asset hashes pass. Configuration bytes, environment values, six mounts and 51 unrelated containers are preserved. Desktop/320px controls are centered without overlap, artwork loads without account query tokens, and playback remains paused at its prior position.

The combined release uses worker v45. The public PR remains a separate profile and is not merged into the official repository by this deployment.

## Safari proxy media compatibility

- [x] Reproduce a CDN response carrying M4A audio with `application/x-www-form-urlencoded`, then normalize generic MIME labels using recognized media extensions on successful proxy responses. Preserve explicit document/error types, failed statuses, byte ranges and upstream address validation.
- [x] Pass all 116 tests, TypeScript checking and production compilation. The regression fails on the preceding implementation; it covers mislabeled AAC, generic FLAC, explicit JSON and upstream rejection.
- [x] Deploy the backend correction `e8256ce` on the customized profile: 45 isolated and 45 live runtime checks, one updated and 262 preserved file hashes, ten authenticated HTTPS assets and actual proxied AAC range bytes/MIME pass. Configuration, environment, mounts and unrelated containers remain unchanged; frontend assets/worker v45 are retained.

A provider authorization error is separate from LX account authentication. A successful source response labeled with the requested quality does not establish actual master audio; observed fallbacks included AAC and MP3. This correction repairs media headers and does not grant provider access or establish physical iPhone playback success.

## Effects and native AirPlay playback

- [x] Reproduce five failures involving forced mobile media capture, resets on existing wireless graphs, and pending pitch/reverb/panner work after AirPlay/Cast handoff.
- [x] Keep mobile audio native even for forced effects initialization; save edits while bypassing local processing on mobile and wireless routes. Guard resets, server-loaded settings and asynchronous DSP work; apply deferred settings to an existing desktop graph on return to local playback. Explain the saved-setting behavior when opening the effects panel.
- [x] Pass all 124 tests and TypeScript checking. Eight route/effects regressions also pass against the isolated and live image modules; desktop effects remain functional.
- [x] Deploy `503e2ab` with worker v46: 45 isolated and 45 live runtime checks, two updated/261 retained file hashes and ten authenticated HTTPS asset hashes pass. Prior fixes/customizations and configuration/environment/mounts/unrelated containers are preserved.

Existing pages that already captured the audio element need a full reload to start with native mobile playback. Physical iPhone/AirPlay playback still needs user confirmation; simulated route transitions do not establish receiver behavior.

## Playback authentication recovery

- [x] Reproduce valid API credentials alongside an expired/missing native-media cookie: audio returns 401 while the server-availability endpoint returns HTTP 200 with `valid:false`. The user reported Windows Chrome/all songs affected, then spontaneous recovery before this patch; the exact browser incident remains an inference from the reproduced gap and timing.
- [x] Renew the API token and media cookie together; retry URL authentication once with refreshed headers. Repair native playback sessions before excluding providers, retain the original track/resume time, reject stale recovery after a track change and show a login prompt when recovery fails. Remove account-password values from startup logging and duplicate-password errors.
- [x] Pass all 134 tests, type checking and compilation. Each isolated/live module passes ten session regressions and eight retained AirPlay/effects regressions, alongside 45 runtime checks and ten authenticated HTTPS asset hashes.
- [x] Publish `b3aea76` through atomic file updates with worker v47. Three files updated/260 retained hashes verified; container ID/start/restart count, configuration/environment/mounts and unrelated containers preserved. Compose selects a tested image containing the same files for future recreation; the current process retains its prior base image. Startup-log redaction takes effect on its next start.

QQ search errors were also observed during the reported interval; the investigation does not establish that every provider failed or that the external search service is repaired. Existing tabs load the frontend correction on their next full reload.

## Song-list scrolling profile

- [x] Measure search-list scrolling and isolate animation work with an A/B/A comparison. Closed drawers retained running marquee animations; pausing them reduced style-calculation work by 43–69% across the tested browser states. Total main-thread improvement varied, so these figures are not a guaranteed frame-rate gain.
- [x] Pause marquee animations only while queue/cache/download drawers are translated closed; preserve their behavior when open. Publish `0521bae` with worker v48 using atomic file updates and retain the current process.
- [x] Pass all 134 tests, 45 isolated/live runtime checks, ten session/eight effects regressions per image, two updated/261 retained hashes and eleven authenticated HTTPS asset hashes including the stylesheet. Browser checks confirm zero running marquee tracks in the closed queue, normal resumption on open, removed diagnostic overrides and preserved paused position.

The profile used connected macOS Chrome, 20 visible search rows and a 98-track queue; the user reported Windows Chrome search/playlists. Windows hardware/GPU/extensions were not profiled and are not ruled out. NAS load was low at the sampled time. No virtualization or saved page-size setting was changed.
