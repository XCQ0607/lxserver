export const ENV_PARAMS = [
  'PORT',
  'BIND_IP',
  'CONFIG_PATH',
  'LOG_PATH',
  'DATA_PATH',
  'PROXY_HEADER',
  'MAX_SNAPSHOT_NUM',
  'LIST_ADD_MUSIC_LOCATION_TYPE',
  'FRONTEND_PASSWORD',
  'WEBDAV_ENABLE',
  'WEBDAV_URL',
  'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD',
  'WEBDAV_SYNC_PATH',
  'WEBDAV_BACKUP_PATH',
  'SYNC_INTERVAL',
  'BACKUP_INTERVAL',
  'USER_ENABLE_PATH',
  'USER_ENABLE_ROOT',
  'ENABLE_WEBPLAYER_AUTH',
  'WEBPLAYER_PASSWORD',
  'DISABLE_TELEMETRY',
  'ENABLE_PUBLIC_USER_RESTRICTION',
  'ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC',
  'ENABLE_PUBLIC_NON_ADMIN_BROWSER_DOWNLOAD',
  'ENABLE_PUBLIC_NON_ADMIN_SERVER_CACHE',
  'ENABLE_PUBLIC_FAVORITES',
  'ENABLE_PUBLIC_NON_ADMIN_ACCESS',
  'ENABLE_CUSTOM_MUSIC_DIR',
  'ENABLE_LOGIN_USER_CACHE_RESTRICTION',
  'ENABLE_CACHE_SIZE_LIMIT',
  'CACHE_SIZE_LIMIT',
  'PROXY_ALL_ENABLED',
  'PROXY_ALL_ADDRESS',
  'ADMIN_PATH',
  'PLAYER_PATH',
  'SUBSONIC_ENABLE',
  'SUBSONIC_PATH',
  'SUBSONIC_ENABLE_DEBUG',
  'SUBSONIC_ONLINE_SEARCH',
  'SUBSONIC_ONLINE_SEARCH_MODE',
  'SUBSONIC_ONLINE_SEARCH_SOURCES',
  'SUBSONIC_LYRIC_TRANSLATION',
  'ARTIST_MAX_FETCH_PAGES',
  'CACHE_NAMING_PATTERN',
  'SYSTEM_ALLOW_UNSAFE_VM',
  'SINGER_SOURCE_PRIORITY',
  'SERVER_NAME',
  'LX_USER_',
] as const

export const SPLIT_CHAR = {
  DISLIKE_NAME: '@',
  DISLIKE_NAME_ALIAS: '#',
} as const

export const LIST_IDS = {
  DEFAULT: 'default',
  LOVE: 'love',
  TEMP: 'temp',
  DOWNLOAD: 'download',
  PLAY_LATER: null,
} as const

export const SYNC_CODE = {
  helloMsg: 'Hello~::^-^::~v4~',
  idPrefix: 'OjppZDo6',
  authMsg: 'lx-music auth::',
  msgAuthFailed: 'Auth failed',
  msgBlockedIp: 'Blocked IP',
  msgConnect: 'lx-music connect',


  authFailed: 'Auth failed',
  missingAuthCode: 'Missing auth code',
  getServiceIdFailed: 'Get service id failed',
  connectServiceFailed: 'Connect service failed',
  connecting: 'Connecting...',
  unknownServiceAddress: 'Unknown service address',
} as const

export const SYNC_CLOSE_CODE = {
  normal: 1000,
  failed: 4100,
} as const

export const TRANS_MODE: Readonly<Record<LX.Sync.List.SyncMode, LX.Sync.List.SyncMode>> = {
  merge_local_remote: 'merge_remote_local',
  merge_remote_local: 'merge_local_remote',
  overwrite_local_remote: 'overwrite_remote_local',
  overwrite_remote_local: 'overwrite_local_remote',
  overwrite_local_remote_full: 'overwrite_remote_local_full',
  overwrite_remote_local_full: 'overwrite_local_remote_full',
  cancel: 'cancel',
} as const

export const File = {
  serverInfoJSON: 'serverInfo.json',
  userDir: 'users',
  userDevicesJSON: 'devices.json',
  userSettingsJSON: 'settings.json',
  userSoundEffectsJSON: 'soundEffects.json',
  userTokensJSON: 'token.json',
  listDir: 'list',
  listSnapshotDir: 'snapshot',
  listSnapshotInfoJSON: 'snapshotInfo.json',
  dislikeDir: 'dislike',
  dislikeSnapshotDir: 'snapshot',
  dislikeSnapshotInfoJSON: 'snapshotInfo.json',
} as const

export const FeaturesList = [
  'list',
  'dislike',
] as const
