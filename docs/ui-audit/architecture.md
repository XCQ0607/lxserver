# UI repair architecture

Keep the existing vanilla JavaScript player and backend. Extend existing queue, search and collection entry points rather than adding another playback model. Add shared UI focus management for dialogs/drawers and history metadata for main views. Preserve nested lyric/detail navigation.

Player CSS owns responsive layout using the same 1025px desktop boundary as the existing theme. The visualizer retains its artwork and audio behavior; its mobile canvas occupies a dedicated row. Static Tailwind output scans player markup and script-generated classes, using the existing CSS-variable theme and breakpoint configuration.

Local artwork endpoints retain their existing authentication and path validation. An optional bounded thumbnail transform runs only after authorization, with byte-limited caching and constrained decoding/concurrency. Original images remain available for lyrics/Media Session/export. Closed queue content is materialized only when opened; existing queue state remains authoritative.

Deployment uses an immutable overlay on the verified live image, a disposable candidate with isolated data and disabled background jobs, protected backup/rollback and recreation of only the lxserver Compose service. Compare assets, runtime, configuration, mounts and unrelated containers before/after.
