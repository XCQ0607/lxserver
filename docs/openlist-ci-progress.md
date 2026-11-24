# OpenList CI teardown repair — 2026-11-17

## Root cause

The 500 ms metadata persistence timer outlived the HTTP-storage test fixture. The next Subsonic test replaced `global.lx` with a config-only runtime; the timer evaluated `location()` outside its error handler and passed an undefined `dataPath` to `path.join()`. CI attributed the resulting asynchronous exception to the earlier upload-delete test. The upload/delete safety assertions themselves passed.

## Repair

- [x] Expose `flushMetadata()` to persist pending observations and clear the debounce timer before fixture teardown.
- [x] Guard delayed persistence against missing runtime/dataPath and a changed data root; keep the entire delayed flush inside error handling.
- [x] Flush before removing the temporary directory, and restore the previous `global.lx` after both HTTP fixtures.
- [x] Deterministic timer regressions cover flush/cancellation, absent runtime, absent dataPath, changed root, and normal deferred persistence. No sleeps or test suppression were added.

## Validation

- Original HTTP-storage test reproduced the uncaught exception; two focused regression cases failed before the repair.
- Repaired OpenList CJS fixture passed five consecutive runs.
- Full dev-based run: 271 CJS and 204 TypeScript tests passed, then two further context/persistence cases were added and all six metadata tests passed.
- `npm run build --ignore-scripts` passed, matching the GitHub Actions build step.
- PR branch integration and Node 22/24 CI results are recorded in follow-up PR comments.
- No live deployment, remote storage migration, or user-data changes.
