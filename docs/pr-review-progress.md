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
