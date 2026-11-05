# Cast architecture

`public/music/js/player/playback.js` adapts the native audio element behind the player's existing media properties, methods and events. Local media events pass through. While casting, the adapter routes controls to the remote output and suppresses native events, preventing duplicate playback and false local recovery. Other audio modules retain the real DOM element.

`chromecast.js` loads Google's official Web Sender SDK in supported secure browser contexts and uses the Default Media Receiver; no custom application registration or server dependency is required. RemotePlayer status drives transport events, position and volume. LOAD commands are serialized and versioned so stale preparation cannot replace a newer track. A seek made during LOAD is applied after it completes; local stall timers cannot recover across a route change. Pending play/pause requests both take effect after LOAD. Cast route changes synchronize lyric speed; local startup restoration yields to resumed remote sessions. Standard/local artwork is resolved through the shared image helper and retained in session metadata. Completion is delivered once. Session resumption adopts existing media without another LOAD. The shared controls remain available on mobile layouts. Equal side columns keep the transport centered, with repeat on the left and speed/wireless controls on the right. Local crossfade is suspended while casting, including an in-progress fade, to preserve receiver volume.

`src/server/integrations/castAccess.ts` issues opaque, random capabilities:

- `POST /api/music/cast/session`: existing player/account authentication, `{url, mime}`; returns a resource-scoped URL and expiry.
- `GET /api/music/cast/session?id=…`: authenticated issuing owner can recover the normalized source for resumption.
- `DELETE /api/music/cast/session?id=…`: authenticated owner revokes a capability.
- `GET/HEAD /api/music/cast/media?id=…`: verifies expiry and the original credentials, then internally routes the immutable target through existing music handlers. Receiver-supplied URLs and authentication headers cannot change its scope.

Capabilities live only in bounded process memory (two hours, sixteen per owner, 1,024 total) and are revoked after track replacement/disconnection. Receiver URLs contain no account credential. Internal music targets are allowlisted; external URLs use the existing public-address validation, pinned DNS connection and redirect validation. Cached/custom media retains its usual ownership/containment rules. Tagging/mutation parameters are excluded from proxy targets. CORS, exposed range headers, no-store responses and HEAD support permit receiver reads and seeking.

Native same-origin audio, artwork and browser downloads use the HttpOnly player session cookie (Secure on HTTPS); the player removes account query tokens from these URLs. Cookie fallback is confined to read-only media handlers and validates the account and session lifetime. Legacy API query-token handling remains for compatibility, but the player does not generate it. API mutations still require their existing header authentication. Local sound-effect changes are saved during wireless playback without building or updating a local graph.

The current combined submission caches first-party modules under `lx-music-web-v51`. Google's SDK stays network-loaded. SDK failure or unsupported browsers leave local playback available.

References: [Google Web Sender setup](https://developers.google.com/cast/docs/web_sender), [integration](https://developers.google.com/cast/docs/web_sender/integrate), [supported media](https://developers.google.com/cast/docs/media).

The combined deployment profile retains its existing custom VU themes and pass-through audio policy: stored crossfade is disabled and direct volume updates do not affect a remote receiver. Transient preload failures remain retryable during foreground playback.

The combined profile, including the user's earlier VU/audio/login customizations, is now included in the upstream submission. `/js/config.js` reads the running package version independently of generated frontend metadata; `scripts/update-build-hash.js` synchronizes the public version and source fingerprint during builds/starts. Player and About share that identity and never infer a release number from unavailable metadata.

Cookie recovery first checks native media access without API headers, then restores the cookie through the existing Token-authenticated verification endpoint. Password renewal is only attempted when a saved password exists; Token-only credentials remain intact. Login supports explicit account and player-password modes, with separate guest credential storage and matching automatic restoration. Once a desktop effects graph captures audio, viewport resizing does not disable its controls; wireless routes still bypass local edits.

Token verification returns the session owner and upgrades guest or other-account cookies to the authenticated account before native media. Existing-Token fast paths also verify this binding. Cast quota ownership uses only a validated, unexpired stored session or a verified account; unknown cookies share the public quota. Playlist card metadata is escaped in both layouts, with JSON arguments escaped for inline click attributes.

Mobile loads remain native until an explicit local effect edit opts into DSP. The panel reports native, local-processed or receiver output. After mobile capture the in-page AirPlay picker directs the user through a native reload, because disconnecting Web Audio does not release a captured media element. That reload preserves queue/position with a one-time session flag without changing the auto-resume preference. Existing wireless/Cast edits remain saved-only.
