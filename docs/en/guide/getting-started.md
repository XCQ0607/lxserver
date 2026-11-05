# Deployment and first run

## Choose a runtime

| Method | Suitable for | Requirements |
| --- | --- | --- |
| Docker / Compose | NAS and unattended servers | Docker and persistent host directories |
| Source build | Development and custom builds | Node.js 22+, npm and Git |
| Server release archive | Running compiled server files | Node.js 22+ and the server release package |
| Desktop app | Using the player and admin console in desktop windows | A package matching your OS and architecture |
| PM2 | Keeping a compiled Node.js deployment running | A built server and separately installed PM2 |

The main service defaults to port `9527`: player at `/`, admin console at `/admin`, Subsonic at `/rest`.

## Docker Compose

Create `compose.yaml` in the directory where you want to keep your data:

```yaml
services:
  lx-sync-server:
    image: xcq0607/lxserver:latest
    container_name: lx-sync-server
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data
      - ./cache:/server/cache
      - ./music:/server/music
      # Optional existing library:
      # - /mnt/nas/music:/library:ro
    environment:
      NODE_ENV: production
      ADMIN_PASSWORD: "replace-with-your-admin-password"
      ENABLE_WEBPLAYER_AUTH: "true"
      WEBPLAYER_PASSWORD: "replace-with-your-player-password"
      # Optional initial sync account:
      # LX_USER_user1: "replace-with-your-user-password"
```

```bash
docker compose up -d
docker compose logs -f --tail=100
```

The alternative image is `ghcr.io/xcq0607/lxserver:latest`. For a pinned deployment, use a version tag that exists in the image registry.

The image writes logs to `/server/data/logs` by default, so the data mount already includes logs. To store logs separately, add `./logs:/server/logs` **and** set `LOG_PATH: /server/logs`. Mounting that directory alone does not change the log destination.

The `cache` and `music` mounts preserve audio in root-directory storage mode. Data-directory storage puts those folders below `/server/data`. Keep the directories used by your account when recreating containers.

## Docker Run

Bash example:

```bash
docker run -d \
  --name lx-sync-server \
  --restart unless-stopped \
  -p 9527:9527 \
  -v "$(pwd)/data:/server/data" \
  -v "$(pwd)/cache:/server/cache" \
  -v "$(pwd)/music:/server/music" \
  -e ADMIN_PASSWORD="replace-with-your-admin-password" \
  -e ENABLE_WEBPLAYER_AUTH=true \
  -e WEBPLAYER_PASSWORD="replace-with-your-player-password" \
  xcq0607/lxserver:latest
```

On Windows PowerShell, Compose avoids differences in multiline shell syntax and host-path expansion.

## Build from source

```bash
git clone https://github.com/XCQ0607/lxserver.git
cd lxserver
npm ci
npm run build
npm start
```

The build generates server JavaScript, player CSS and the file-manager bundle, and checks the audio fingerprint utility. Installation and the first build need access to dependency and binary downloads.

For development, use `npm run dev`. Production runs compiled files in `server/`; changing TypeScript source requires another build before restarting production.

## Compiled releases and desktop app

Download a package from [Releases](https://github.com/XCQ0607/lxserver/releases). Desktop packages vary by release; choose the OS and architecture listed in that release's assets. The desktop app manages its storage separately and can choose another port when `9527` is busy; use the address shown by the app.

A server archive contains compiled files such as `server/`, `public/`, `index.js` and `package.json`. It can be launched directly after extracting it. If production dependencies are absent or incompatible with the target platform, install them first:

```bash
npm install --omit=dev
node index.js
```

GitHub's automatically generated **Source code** archives are source distributions, not compiled server packages. Follow the source-build instructions for those archives.

`node index.js` runs the compiled server without npm lifecycle hooks. `npm start` also runs the repository's prestart steps, which check the fingerprint utility and refresh build metadata. Keep the `scripts/` directory when using the npm startup workflow.

## PM2 and local image builds

After building the project, install PM2 separately and run the supplied ecosystem configuration from the project directory:

```bash
npm install -g pm2
npm run prd
pm2 logs lx-music-sync-server
pm2 status
pm2 save
```

`npm run prd` executes `pm2 start ecosystem.config.js --env production`; it does not compile the project. PM2 is not a project dependency. OS boot integration is a separate setup step; saving a process list alone does not configure it.

To build the image from your current checkout:

```bash
docker build -t lxserver:local .
```

Use `lxserver:local` in your Compose file instead of the registry image. `npm run electron:dist` builds and packages the desktop app; packaging requirements and native-module support depend on the target platform.

## First-run checklist

1. Open `http://server-ip:9527/admin` and sign in with your configured administrator password. The unchanged default is `123456`.
2. Create a personal account in user management and set its sync password.
3. Open the player at `http://server-ip:9527/`. If player access authentication is enabled, enter the player password, then sign in to your personal account as needed.
4. Import and enable a working custom source for online playback.
5. For local music, check the storage selection, mounted paths and account permissions, then scan the directory.

## What each command does

| Command | Behavior |
| --- | --- |
| `npm start` | Run prestart checks, then compiled server |
| `node index.js` | Run compiled server without npm prestart |
| `npm run dev` | Run source through tsx/nodemon |
| `npm run prd` | Start compiled server under PM2 in production mode |
| `docker compose up -d` | Create/start containers from Compose |
| `npm run electron:dist` | Build/package desktop app, not server hosting |

Development and production can access the same data if configured that way. Use a separate `DATA_PATH` when experimenting to avoid changing your regular accounts.

For client addresses see [sync and console](./sync-server.md). See [configuration](./configuration.md) and [operations](./operations.md) for settings, reverse proxy, upgrades and recovery.
