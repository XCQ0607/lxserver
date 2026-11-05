# UI repair verification

- [x] Responsive footer/VU and controls, including resizing between mobile/tablet/desktop.
- [x] Queue insertion preserves current playback; unopened queue omits rows and artwork.
- [x] Default List supports individual and batch collection changes.
- [x] Search replacement cancels prior requests; provider deadlines cover response-body reads; partial failures remain visible.
- [x] Dialog focus/inert lifecycle handles nested input/confirmation surfaces.
- [x] iPhone agreement remains scrollable in landscape; inputs use16px text and account names disable capitalization.
- [x] Local iPhone effect edits activate processing; wireless/Cast edits remain saved-only; native reload releases processing and preserves saved settings.
- [x] Regression suite:168CommonJS and11TypeScript tests on current upstream dev, plus production compilation and compiled authorization smoke test.

The three configuration-migration tests from the separately deployed source are omitted here because that deployment-only module is absent from upstream dev. Backend route fixtures use upstream's actual cache-browse request context.

The earlier deployed repair source passed182tests,69isolated/65live HTTP checks,31effects/session/login regressions per image and14public HTTPS asset checks. These deployment results describe that source; this PR is rebased onto upstream v2.1.4 and retains its newer VU/login/library features.

An iPhone18Pro/iOS27.0 simulator, driven through CLI HID touches, verified a16x RMS change between EQ-12/+12dB, a1kHz→1.5kHz pitch shift, a reverb change and reversal of stereo channel dominance. Native reload left no graph/context/bridge and retained saved effects. The PR sound-effects and AirPlay modules match those signal-tested modules exactly. This establishes simulator processing, not physical speaker fidelity or receiver delivery.

Broad simulator checks cover playback, seek/speed/mode, search/pagination, collections, queue removal/clear, playlists/rankings, lyrics/export, settings and artist/album navigation. Queue dragging, PWA/admin, exhaustive secondary settings/import/export mutations and physical receiver/lock-screen playback remain unverified. The original query-specific search500and old WebKit crash have no proven root cause; this change does not claim to fix those incidents.

Combined branch browser verification uses a separate loopback-only server with disposable data/configuration. Account login succeeds; the modern login retains one username field,16px input text and disabled capitalization. At320/390/1024/1440px and after desktop-to-mobile resize, Play stays inside the viewport, the document has no horizontal overflow and the mobile VU starts below song information. Mode/rate menus remain within the phone viewport; the effects modal exposes dialog semantics and Escape closes it.
