FROM node:22-alpine AS base

FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /source-code
COPY . .

RUN (apk add --no-cache chromaprint || true) \
  && npm ci --ignore-scripts --no-audit --no-fund \
  && npm run build

FROM base AS deps
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund


FROM base AS final
WORKDIR /server

RUN apk add --update --no-cache chromaprint \
  || echo "chromaprint apk not found, will use bundled binary"

# OpenList 备份依赖 node:sqlite（Node >= 22.13），构建期强校验，避免运行时才报错
RUN node -e "const v=process.versions.node.split('.').map(Number); process.exit((v[0]>22||(v[0]===22&&v[1]>=13))?0:1)" \
  || { echo 'node >= 22.13 required for OpenList backup (node:sqlite)'; exit 1; }

COPY --from=deps /deps/node_modules ./node_modules
COPY --from=builder /source-code/server ./server
COPY --from=builder /source-code/public ./public
COPY --from=builder /source-code/config.js /source-code/index.js /source-code/package.json ./

VOLUME /server/data
ENV DATA_PATH='/server/data'
ENV LOG_PATH='/server/data/logs'

EXPOSE 9527
ENV NODE_ENV='production'
ENV PORT=9527
ENV BIND_IP='0.0.0.0'
# ENV PROXY_HEADER 'x-real-ip'
# ENV SERVER_NAME 'My Sync Server'
# ENV MAX_SNAPSHOT_NUM '10'
# ENV LIST_ADD_MUSIC_LOCATION_TYPE 'top'
# ENV LX_USER_user1 '123.123'
# ENV LX_USER_user2 '{ "password": "123.456", "maxSnapshotNum": 10, "list.addMusicLocationType": "top" }'
# ENV CONFIG_PATH '/server/data/config.js'
# ENV WEBDAV_URL ''
# ENV WEBDAV_USERNAME ''
# ENV WEBDAV_PASSWORD ''
# ENV SYNC_INTERVAL '60'
# ENV ENABLE_WEBPLAYER_AUTH 'false'
# ENV WEBPLAYER_PASSWORD '123456'
# ENV LOG_PATH '/server/logs'
# ENV DATA_PATH '/server/data'
# ENV PLAYER_ENABLE_AUTH 'true'
# ENV PLAYER_PASSWORD '123.456'

CMD [ "node", "index.js" ]
