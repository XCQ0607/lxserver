# Mobile navigation, playlist scrolling and route controls

- Keep the active navigation backdrop tappable without weakening isolation for other dialogs.
- Apply desktop collapse only at >=1025px; preserve the preference during mobile round trips.
- Use one mobile playlist scroller for the description and songs, remove the expanded header cap and retain manual collapse.
- Retain a 48px expanded Play control and 44px Previous/Next targets; reserve a second row when route controls would overlap Next.
- Distinct inline AirPlay/Chromecast symbols retain native handlers, availability/disabled state, accessible names and connected state. No native audio-policy, authorization or VU change.

## Verification

Five targeted regressions, 24 Chromium/WebKit native navigation cases, 20 viewport cases with four wireless states each, and TypeScript/build pass. The full CJS suite has 276 passes and the existing OpenList teardown failure, also reproduced on pristine dev. Native device discovery, physical iPhone and audible receiver playback were not tested.
