# Web player UI repairs

Repair the audited player without changing saved preferences, native/AirPlay/Cast routing, lyric metadata, provider configuration or library data.

- Keep all player controls and the VU meter visible without overlap at 320px, 390px, tablet and desktop widths, including after resizing.
- Expose labelled, keyboard-accessible controls with adequate touch targets. Dialogs contain focus, close on Escape where dismissal is allowed, and restore focus; closed drawers cannot receive focus.
- Allow Play next and Add to queue without replacing the queue or interrupting playback. Include Default List in the collection picker.
- Restore the prior main view through browser Back/Forward.
- Cancel obsolete searches, ignore late responses, bound provider waits, show partial results and distinguish provider failure from no results.
- Defer closed queue rendering/artwork, serve bounded thumbnails, compile utility CSS ahead of time and defer optional features.
- Pass existing regression tests, type/build checks, isolated browser/HTTP checks and candidate/live asset verification before declaring deployment successful. Report physical-device limitations separately.
- Verify mobile flows on the newest installed iPhone simulator runtime; keep simulator, browser-fixture and physical-device results distinct. Keep short-screen agreements/detail actions reachable, avoid iOS input zoom and hover-only first taps, and fit player menus within the viewport.

- Make explicit iPhone effect edits change local audio output while native startup and existing AirPlay/Cast routes remain protected. Explain the native reload required to release Safari media capture before AirPlay.
