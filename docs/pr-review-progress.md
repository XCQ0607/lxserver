# Bot review repair progress

## 2026-11-17 — search-radio review (#528, shared with #530/#531)

- [x] Verified recommendation `_searchRadio` markers already persist; added a real save/JSON/restore queue regression and persisted explicit play-next markers too.
- [x] Device disconnect and logout cancel pending recommendation continuation before pausing.
- [x] Bound YouTube Music and QQ recommendation JSON body reads; streaming defaults unchanged.
- [x] Preserve legitimate titles ending in Live; explicit version annotations remain filtered.
- [x] Cache identities include provider/seed ID, with text fallback only when IDs are absent.
- [x] Validation: 15 queue tests, 16 recommendation tests, TypeScript no-emit and diff checks pass.
- [ ] Physical device pause/playback qualification (not claimed by these tests).

Full branch validation: 216 TypeScript tests and 286 CJS tests passed before the final timeout regression; the CJS runner also reports one pre-existing OpenList asynchronous teardown failure. Reproduced that failure on the unchanged #531 head (same OpenList test). Final targeted run: 16 recommendation + 15 queue tests passed. No live deployment performed.


## 2026-11-17 — follow-up bot review

- [x] Browser recommendation fetch plus JSON body read share an 8-second abort deadline; timeout returns an empty list and clears only the matching cache request so normal queue fallback proceeds.
- [x] Quality deduplication and start-position lookup use the same platform-qualified identity, preserving distinct songs with equal raw provider IDs and leaving unidentified songs unmerged.
- Validation: 18/18 focused recommendation/queue tests pass, including stalled fetch/JSON and stale-request cache isolation. Full CJS: 289 passed, one pre-existing OpenList teardown failure; no-emit compilation and diff checks passed.

These PR changes have not been deployed. The separate live marquee-only release is unchanged. The OpenList failure in #528/#530/#531 is the previously reproduced asynchronous teardown error, not a passing full-suite result.


## 2026-11-17 — OpenList CI failure repaired

The previously reported asynchronous OpenList teardown failure is now fixed. A pending metadata persistence timer outlived the test runtime; explicit flushing and runtime-root validation now prevent the late undefined-path exception. Both HTTP fixtures restore their previous global runtime. See `docs/openlist-ci-progress.md`.

Final integrated local validation: **289/289 CJS and 222/222 TypeScript tests passed**, and `npm run build --ignore-scripts` passed. No test suppression or added waiting sleeps; no deployment. Node 22/24 GitHub Actions results will be recorded in the PR follow-up.
