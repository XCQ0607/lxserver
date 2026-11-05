# Operations and troubleshooting

For a service that already starts, use this page to plan updates, backups and diagnosis. See [deployment](./getting-started.md) for installation and [configuration](./configuration.md) for paths and permissions.

## Identify the running instance

Record the page's version/build fingerprint and the actual host, port and path. Source changes do not update an already compiled production server. The desktop app may choose another port if its preferred port is occupied.

```bash
docker compose ps
docker compose logs --tail=100
```

For PM2:

```bash
pm2 status
pm2 logs lx-music-sync-server --lines 100
```

Avoid running terminal, PM2 and desktop instances against the same data directory at the same time. Logs follow `LOG_PATH`: the image defaults to `/server/data/logs`; source runs default to project `logs/`.

## Update and rollback

1. Back up data, external configuration, used cache/music folders and custom libraries. Record the current image tag or Git revision.
2. Replace the process using its existing supervisor, preserving mounts and permissions.
3. Recreate Docker containers with the new image, or install dependencies and rebuild source before restarting.
4. Check startup, account access, playlists, a local scan and actual playback.

After updating source in a PM2 deployment:

```bash
npm ci
npm run build
pm2 restart ecosystem.config.js --env production --update-env
```

Application rollback and data rollback are separate. An older binary may not understand state written by a newer version; inspect compatibility and use a backup when needed.

## Backup coverage

| Method | Restores | Does not by itself preserve |
| --- | --- | --- |
| Playlist snapshots | Playlist changes/deletions | Audio, full configuration, external libraries |
| Configuration backups | config.js | Every user file or audio library |
| WebDAV sync/backup | Included data | Exclusions, external libraries, audio outside data |
| Filesystem backup | The directories actually copied | Unincluded mounts and external paths |

Preserve user state together with audio. Subsonic local registry/state files retain IDs, favorites and playlist relationships. Moving or renaming audio externally can assign it a new identity.

WebDAV incremental checks default to 60 minutes (`SYNC_INTERVAL`); full backup intervals default to 24 hours (`BACKUP_INTERVAL`). Startup with WebDAV configured attempts remote recovery and then reloads configuration/accounts; recovery is not limited to a first start with empty data.

## Reverse proxy

Preserve paths, support WebSocket upgrades and allow SSE/audio streams to remain open. This is a same-host Nginx HTTP forwarding example. Configure your domain and TLS separately; this example does not enable HTTPS.

```nginx
# Inside http {}, alongside server {}
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name music.example.com;

    location / {
        proxy_pass http://127.0.0.1:9527;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }
}
```

Inside a proxy container, `127.0.0.1` refers to that container; use an accessible service name or host instead. File uploads also depend on the proxy's request-body size limit. Match `PROXY_HEADER` to the original-IP header supplied by your trusted proxy.

After path changes, check the player, console, LX sync and `/rest`. With HTTPS pages and HTTP media, review player auto-proxy behavior. Server outgoing proxy settings and player media forwarding are separate controls.

## Symptoms and checks

| Symptom | Check in order |
| --- | --- |
| Page works, playback fails | Source enabled → platform/quality support → resolution logs → URL expiry/network |
| Empty library | Account → saved location → mounted container path → read permission → scan logs |
| Tag writes fail | File write access → account write permission → read-only mount → format support |
| Settings revert | Active config path → environment → WebDAV restore logs |
| Old UI | Running process/container → completed build → fingerprint → browser refresh |
| Downloads stopped | Queue errors → source availability → disk/permissions → resume |
| Matching interrupted | Restart interrupts active matching; select remaining files again |
| Remaster skips | Missing association, already at target quality, duplicate target or no suitable replacement |
| Subsonic misses web files | Same account → saved location → custom/local playlist switches → client refresh |
| Cast receiver found, playback fails | Secure context → receiver reachability → codec → media request logs |

## Reporting an issue

Include version/build fingerprint, deployment, OS/architecture, client version, reproduction steps and relevant logs. Identify whether failure happens during search, resolution, download, scanning or playback. Remove passwords, tokens, cookies and authorized media URLs before sharing logs.
