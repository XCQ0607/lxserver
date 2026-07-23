# Web Player Usage Guide

LX Music Sync Server provides a modern Web music player at the root route `/` by default (can also be customized to `/music` via `PLAYER_PATH`). It can achieve remote playback, search, and multi-terminal synchronization interaction.

## Core Feature List

Functions currently supported by the Web player:

- **Search and Sound Sources**: Supports searching across five major music platforms, custom uploading JS scripts or importing URLs to extend sound sources. Now supports searching for albums, artists, and favoriting them.
- **Playback Control**: Multi-audio quality selection (128k/320k/FLAC/Hi-Res) and automatic downgrade if audio quality fails. Supports speed adjustment (0.5x-2.0x), fade-in/fade-out, and playback progress memory.
- **User Interaction**: Supports keyboard shortcuts, PWA, song comments, and multiple playback modes (single loop, list loop, random, etc.).
- **Synchronization Function**: Supports reading and displaying user favorites and playlists saved on the server, and supports hot search display and batch download operations.
- **Protocol Support**: Fully compatible with the **Subsonic** protocol, allowing you to use various Subsonic clients (e.g., Yinliu, Feishin, etc.) to connect.
- **UI Experience**: Audio waveform display at the bottom, built-in 5 types of themes, sleep timer.
- **Lyric Extension**: Supports displaying translation and romaji, supports Karaoke word-by-word high-light rendering, and supports sharing lyric images.

---

## Access the Player

Default access address (root path):
**Example**: `http://IP:9527` (or `http://IP:9527/music` if configured)

If the administrator has set `ENABLE_WEBPLAYER_AUTH = true` in the server environment variables, the set `WEBPLAYER_PASSWORD` must be entered every time this page is opened to enter the playback interface.

---

## Core Mechanism Description

The Web player adopts the following mechanisms for requests and caching:

### 1. Account Isolation and Management Mechanism for Sound Source Scripts

To ensure that multiple users do not interfere with each other, especially when different sound sources are configured, the server side has formulated complete isolation strategies for the storage, rendering and scheduling of third-party sound source scripts:

- **Classified Storage (Physical Isolation)**: If you upload the corresponding JS script source after logging in to your account, the file will be independently saved under the `data/users/source/{username}` folder. If it is uploaded directly (or by an administrator) without logging in, the source file will be placed in the global public directory `source/_open`.
- **List Fusion Rendering**: When the front-end fetches the source list, the system will obtain all available sources under the "public directory", plus the private sources under "your current exclusive directory", and combine them into your final visible sound source library.
- **Same-source Private Overriding (Shielding/Deduplication)**: If sound sources with the same ID exist in the global public directory and your exclusive directory, the system will **absolutely prioritize** recognizing your private source. At this time, the corresponding public source will be completely shielded (hidden for deduplication in your list). **Special Note:** Even if you set this same-name private source uploaded by yourself to "disabled" on the panel, the system will also determine that "you explicitly rejected/closed this source" and will never downgrade to call the public same-name source that is actually enabled by default.
- **Independent State of Public Source Switch (Preference Isolation)**: When you **enable/disable** someone else's (regular public) sound source in your own management panel, the system **will not** go to the global library to modify its real state and affect others. Instead, it will generate a `states.json` in your exclusive directory to independently record only "your preference for resisting or enabling this public source". Before the server side captures the real playback link, it will also strictly follow this private preference of yours for scheduling.
- **Mixed Sorting and Fault Tolerance Mechanism (Grouped by State)**: When dragging the sound source list for sorting, the system will save the absolute order of the current mixed list in the `order.json` in your exclusive directory.
  - **Top-level Group**: "Enabled" sources will always be locked and grouped before "disabled" sources.
  - **Absolute Position within Group**: Inside respective enabled/disabled groups, even if your private sources and public sources are mixed randomly, they will strictly obey the relative dragging order you saved.
  - **Dynamic Downward Compatibility**: Even if a certain public source is subsequently deleted globally by the administrator, by virtue of the above recording mechanism, the rest of the sources in your list will still strictly keep the relative order unchanged; if your exclusive sorting configuration is accidentally cleared or damaged, the system will also intelligently fall back to reading the public hall's default sorting data as a backup, achieving a smooth and unperceived experience to the greatest extent.

### 2. Automatic Quality Downgrade

After selecting the **default audio quality** at the front-end (for example, 320k is selected), if the analysis engine fails when obtaining the target audio quality:
The system will automatically try downward according to the downgrade order of `flac -> 320k -> 192k -> 128k`. Until an audio quality of one level lower that can be successfully parsed and played is obtained, thereby avoiding playback problems as much as possible.

### 3. Data Layer Proxy Forwarding

To avoid cross-origin blocking (CORS) that may be encountered when the browser directly fetches online music links:
If **Playback Music Proxy** or **Download Music Proxy** is enabled in settings:

- The front-end browser will no longer directly request the real music direct link, but instead request this LX Node server built by you.
- After the server-side obtains the real music data stream in the background, it will then directly forward it to your front-end browser in packets, thereby bypassing cross-origin restrictions.

In addition, the Web player also supports the **Auto Proxy** function:
- **Mixed Content Protection**: When you deploy the service under the HTTPS protocol, the browser will default to blocking media resource requests under the HTTP protocol (i.e., "mixed content" restriction) for security considerations.
- **Intelligent Identification**: After "Auto Proxy" is enabled, if the system detects that it is currently in an HTTPS environment and the obtained sound source link is the HTTP protocol, it will automatically transfer this request to be proxied by the server side. This mode not only solves the playback compatibility problem under HTTPS, but also retains the direct connection response speed when the sound source itself supports HTTPS.

### 4. Storage and Three-level Cache Mechanism

To reduce repetitive network requests and improve playback speeds, playback requests undergo hierarchical processing involving two core physical directories:

#### Directory Differences and Usage:
- **`/cache` Directory (Temporary Cache)**: If "Cache song files" is enabled in settings, audio will be automatically downloaded and saved here during the first playback. `/cache` is intended as a **temporary directory**; the system may automatically clean up old files based on settings (e.g., if space limits are exceeded).
- **`/music` Directory (Persistent Library)**: This is a **persistent directory** intended for long-term storage. You can manually place external songs here via the file system or management console.
- **Data Migration**: In the **Local Music** interface, you can choose to "move" cached files from the `/cache` directory to the `/music` directory. Once moved, the file is saved as a persistent resource and will not be automatically deleted by cache cleanup logic.

#### Cache Levels:
- **Level 1 (Physical File)**: The player first checks for matching physical files in `/music` and `/cache`. If found, the server transfers the local file to the front-end (supporting 206 Partial Content break-point pulling), allowing for lag-free progress bar dragging.
- **Level 2 (Link Cache)**: Successfully direct link URLs are saved in the browser's LocalStorage.
- **Level 3 (Real-time Parsing)**: When no physical file is found in local directories and the historical link has expired, the system re-fetches a new link via source scripts.

---

> ⚠️ **Data Space Cleanup**: Clicking the various sub-item "Cache Cleanup" buttons in the player settings interface will issue a cleanup instruction for the specified directory (calling `fs.unlinkSync`, etc.) to the server side, truly deleting historical download files and link records existing on the hard disk or LocalStorage.
