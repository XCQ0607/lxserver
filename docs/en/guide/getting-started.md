# Quick Start Deployment Guide

Welcome to the LX Music Data Synchronization and Web Playing hub service. This platform provides a private cloud data synchronization integration solution, along with a fully functional online high-quality media streaming capability.

## Infrastructure Dependencies

Before starting this service project, please ensure that the host system (or virtual machine, containerized facility) carrying this instance meets the following minimum prerequisites:

**Running Directly from Source:**

- **Node.js**: `v20.x` or higher (`v20.x` / `v22.x` LTS version is recommended for production environments).
- **Network Resources**: Ensure that the listening port required for the business (default configuration is `9527`) has been correctly allowed in the host firewall policy and the cloud provider's security group rules.

**Running on Containerized Facilities (Preferred for Production):**

- `Docker Engine` runtime.
- `Docker Compose` (required when involving declarative service orchestration).

---

## Deployment Execution Plan and Best Practices

### Option 1: Using Desktop Client

For desktop users, we strongly recommend using the **Desktop Client** based on Electron. It integrates the server management and player, featuring system tray support.

1. **Download**: [GitHub Releases](https://github.com/XCQ0607/lxserver/releases/latest)
2. **Choose Version**:
   - **Windows**: Download `Universal.exe` (All-in-one) or `portable.exe` (Portable version).
   - **macOS**: Download `universal.dmg` (Supports Intel/M1/M2).
   - **Linux**: `.deb` (Debian/Ubuntu) and `.AppImage` formats available.
3. **Initialization**: The first launch will guide you to select a data storage location, then the service will start in the background and be visible in the system tray.

### Option 2: Containerized Deployment Based on Docker Engine

This project supports pulling images from Docker Hub or GitHub Packages:

- **Docker Hub**: `xcq0607/lxserver:latest`
- **GitHub Packages**: `ghcr.io/xcq0607/lxserver:latest`

Execute the following command to start the container:

```bash
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  -v $(pwd)/cache:/server/cache \
  -v $(pwd)/music:/server/music \
  --name lx-sync-server \
  --restart unless-stopped \
  xcq0607/lxserver:latest
```

**Container Volume Mappings:**

- `-v $(pwd)/data:/server/data`: This configuration is a **core mandatory item**. It is responsible for exporting all application-layer state data generated within the instance to the host for persistent storage.
- `-v $(pwd)/logs:/server/logs`: A physical mount point used to receive and output all graded audit logs of the service.
- `-v $(pwd)/cache:/server/cache`: Used to store music cache files, significantly improving loading speed during repeated playback.
- `-v $(pwd)/music:/server/music`: **Used exclusively for storing downloaded songs.**

**Declarative Docker Compose:**
For standardized long-term management in production implementation, create a definition configuration named `docker-compose.yml`:

```yaml
version: '3'
services:
  lx-sync-server:
    image: xcq0607/lxserver:latest
    container_name: lx-sync-server
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data
      - ./logs:/server/logs
      - ./cache:/server/cache
      - ./music:/server/music
    environment:
      - NODE_ENV=production
      # - ADMIN_PASSWORD=123456
      # - ENABLE_WEBPLAYER_AUTH=true
      # - WEBPLAYER_PASSWORD=yourpassword
```

After reviewing the configuration correctly, start the infrastructure instance set with the command `docker-compose up -d`.

### Option 2: Source Compilation Deployment Based on Physical Environment

For restricted non-containerized environments or secondary research and development expansion scenarios, you need to assemble and pull up the process directly on the operating system:

```bash
# 1. Extract the code from the remote code repository to the current directory in the Main branch state
git clone https://github.com/XCQ0607/lxserver.git 
cd lxserver

# 2. Call the strict analysis process to initialize the module dependency library
npm ci 

# 3. Perform pre-compilation aggregation processing on TypeScript types and Vue DOM templates
npm run build

# 4. Execute the production node start command based on the built-in scheduler
npm start
```

*Engineering Practice Tip: For native application hosting in unattended server environments, it is recommended to introduce a process-level scheduling and restart control system such as `pm2`: `pm2 start npm --name "lxserver" -- start`.*

---

## Load Front-end and Nginx Reverse Proxy Access Strategy

Before exposing it to the public network main process node, it is strongly recommended to connect a mature Web daemon gateway instance. This is intended to securely apply SSL encryption and hide internal distribution port features.

The following is a standardized Nginx reverse proxy configuration reference example adapted to the system's WebSocket duplex link mechanism and tracing the user's source-end IP Header parsing (taking over traffic through the network and tunnel takeover forwarding from universal `80 / 443` ports to this service `9527`):

```nginx
server {
    listen 80;
    server_name music.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:9527;
  
        # Define the Header transmission policy to ensure that the Node layer can get the client's public network layer IP
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  
        # Complement the long-connection upgrade feature definition (necessary condition for internal synchronization communication socket services)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Service Access & Client Connection Guide

After the service starts, you can access the Web interfaces or connect clients via the following ways:

### 1. Web Interface Access
| Module | Access URL | Auth Requirement | Description |
| :--- | :--- | :--- | :--- |
| **Web Player** | `http://<server-ip>:9527/` | Default free (can be enabled via `ENABLE_WEBPLAYER_AUTH`) | Modern online music web player supporting multi-source search and streaming. |
| **Admin Console** | `http://<server-ip>:9527/admin` | Admin password (default `123456`) | User management, playlist and snapshot review, WebDAV backup and system settings. |

### 2. LX Music Client Sync (Desktop / Mobile)
Go to client "Settings → Sync Settings" and choose Custom Server:
- **User Path Mode (Recommended, enabled by default)**: Connection URL `http://<server-ip>:9527/<username>` (e.g. `http://192.168.1.100:9527/user1`), password is the user's password. **Allows multiple users to use identical passwords**.
- **Root Path Mode (Requires `USER_ENABLE_ROOT`)**: Connection URL `http://<server-ip>:9527`, password is the user's password. **Requires all user passwords to be strictly unique**.

### 3. Subsonic Music Client Connection
- **Server Address**: `http://<server-ip>:9527/rest` (or `http://<server-ip>:<port>/rest` if `SUBSONIC_PORT` is configured).
- **Authentication**: Log in with user credentials created in the Admin Console.

For more advance details on implementing silent import of underlying variables in the early lifecycle of instantiation, and configuration hierarchy rewriting, please move to read "[Configuration Engine and Environment Variable Injection Guide](./configuration.md)".
