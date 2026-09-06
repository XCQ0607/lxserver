# Quick Start Deployment Guide

Welcome to the LX Music Data Synchronization and Web Playing hub service. This platform provides a private cloud data synchronization integration solution, along with a fully functional online high-quality media streaming capability.

## Infrastructure Dependencies

Before starting this service project, please ensure that the host system (or virtual machine, containerized facility) carrying this instance meets the following minimum prerequisites:

**Running Directly from Source:**

- **Node.js**: `v16.x` or higher (`v18.x` LTS version is recommended for production environments).
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
      # - FRONTEND_PASSWORD=123456
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

## Verify the Health of Delivered Components

After the service instance registration and scheduling are completed, and the traffic tunnel is established, administrators can check the connectivity status of the two sub-service systems in the browser respectively:

| Module System Identifier                             | Deployment Application Node Level | Default Domain Check                                                                                                                                            | Core Application Capabilities and Infrastructure                                                                                                                     |
| ---------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic Operation Monitoring and Sync Server** | `/admin`                        | Requires default key:`123456`                                                                                                                                 | Perform account role control authorization, review connection endpoint survival status, and perform global WebDAV off-site backup scheduling configuration reset.    |
| **Rich Client Web Streaming Console**          | `/` (Root path)                 | Adjustable (depends on whether the administrator has configured the password environment variable) | Provides a multi-stack music information stream convergence point checking engine and completes the audio-visual business rendering logic of the end-user interface. |

For more advance details on implementing silent import of underlying variables in the early lifecycle of instantiation, and configuration hierarchy rewriting, please move to read "[Configuration Engine and Environment Variable Injection Guide](./configuration.md)".
