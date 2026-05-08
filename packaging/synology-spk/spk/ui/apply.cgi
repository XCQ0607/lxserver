#!/bin/sh

echo "Content-Type: application/json"
echo ""

PKG_NAME="lxserver"
PKG_BASE="/var/packages/${PKG_NAME}"
TARGET_DIR="${PKG_BASE}/target"
SHARES_DIR="${PKG_BASE}/shares/lxserver"
PERSIST_DIR="${SHARES_DIR}/synology-pkg-var"
PORT_FILE="${PERSIST_DIR}/port"
BIND_IP_FILE="${PERSIST_DIR}/bind_ip"
PASSWORD_FILE="${PERSIST_DIR}/admin_password"
SOURCE_ENABLED_FILE="${PERSIST_DIR}/default_source_enabled"
SOURCE_AUTO_UPDATE_FILE="${PERSIST_DIR}/source_auto_update_enabled"
SOURCE_FORCE_UPDATE_FILE="${PERSIST_DIR}/source_force_update"
RESTART_LOG="${PERSIST_DIR}/apply-restart.log"

read_file_trim() {
  f="$1"
  if [ -f "$f" ]; then
    tr -d ' \t\r\n' <"$f" 2>/dev/null || true
  else
    printf ''
  fi
}

read_flag_default_1() {
  f="$1"
  if [ ! -f "${f}" ]; then
    echo "1"
    return
  fi
  v="$(read_file_trim "${f}")"
  case "${v}" in
    0|false|FALSE|off|OFF|no|NO) echo "0" ;;
    *) echo "1" ;;
  esac
}

if [ "${REQUEST_METHOD}" = "GET" ]; then
  PORT_VALUE="$(read_file_trim "${PORT_FILE}")"
  BIND_IP_VALUE="$(read_file_trim "${BIND_IP_FILE}")"
  if [ -z "${PORT_VALUE}" ]; then PORT_VALUE="9527"; fi
  if [ -z "${BIND_IP_VALUE}" ]; then BIND_IP_VALUE="::"; fi
  if [ -f "${PASSWORD_FILE}" ]; then
    HAS_PASSWORD="true"
  else
    HAS_PASSWORD="false"
  fi
  DEFAULT_SOURCE_ENABLED="$(read_flag_default_1 "${SOURCE_ENABLED_FILE}")"
  SOURCE_AUTO_UPDATE_ENABLED="$(read_flag_default_1 "${SOURCE_AUTO_UPDATE_FILE}")"
  echo "{\"success\":true,\"port\":\"${PORT_VALUE}\",\"bind_ip\":\"${BIND_IP_VALUE}\",\"has_password\":${HAS_PASSWORD},\"default_source_enabled\":\"${DEFAULT_SOURCE_ENABLED}\",\"source_auto_update_enabled\":\"${SOURCE_AUTO_UPDATE_ENABLED}\"}"
  exit 0
fi

if [ "${REQUEST_METHOD}" != "POST" ]; then
  echo '{"success":false,"error":"Method Not Allowed"}'
  exit 0
fi

read_post_data() {
  length="${CONTENT_LENGTH:-0}"
  if [ -z "${length}" ] || [ "${length}" -le 0 ] 2>/dev/null; then
    printf ''
    return
  fi
  dd bs=1 count="${length}" 2>/dev/null
}

urldecode() {
  data="$(echo "$1" | sed 's/+/ /g')"
  printf '%b' "${data//%/\\x}"
}

get_form_value() {
  key="$1"
  body="$2"
  raw="$(printf '%s' "$body" | tr '&' '\n' | awk -F= -v k="$key" '$1==k {print substr($0, index($0, "=")+1); exit}')"
  urldecode "$raw"
}

normalize_bool() {
  case "$1" in
    1|true|TRUE|on|ON|yes|YES) echo "1" ;;
    *) echo "0" ;;
  esac
}

BODY="$(read_post_data)"
ACTION="$(get_form_value action "$BODY" | tr -d ' \t\r\n')"

mkdir -p "${PERSIST_DIR}" || {
  echo '{"success":false,"error":"Failed to create persist directory"}'
  exit 0
}

if [ "${ACTION}" = "update_source" ]; then
  date +%s > "${SOURCE_FORCE_UPDATE_FILE}" 2>/dev/null || true
  SYNOPKG_PKGNAME="${PKG_NAME}"
  SYNOPKG_PKGDEST="${TARGET_DIR}"
  CTL_SCRIPT="${PKG_BASE}/scripts/start-stop-status"
  export SYNOPKG_PKGNAME SYNOPKG_PKGDEST
  {
    echo "[$(date '+%F %T')] apply.cgi: requested source update"
  } >>"${RESTART_LOG}" 2>&1
  nohup sh -c "echo '[`date '+%F %T'`]' apply.cgi: stop && ${CTL_SCRIPT} stop && echo '[`date '+%F %T'`]' apply.cgi: start && ${CTL_SCRIPT} start && echo '[`date '+%F %T'`]' apply.cgi: done_update_source" >>"${RESTART_LOG}" 2>&1 &
  echo '{"success":true}'
  exit 0
fi

PORT="$(get_form_value port "$BODY" | tr -d ' \t\r\n')"
BIND_IP="$(get_form_value bind_ip "$BODY" | tr -d ' \t\r\n')"
PASSWORD="$(get_form_value password "$BODY")"
DEFAULT_SOURCE_ENABLED="$(normalize_bool "$(get_form_value default_source_enabled "$BODY")")"
SOURCE_AUTO_UPDATE_ENABLED="$(normalize_bool "$(get_form_value source_auto_update_enabled "$BODY")")"

case "${PORT}" in
  ''|*[!0-9]*)
    echo '{"success":false,"error":"Invalid port"}'
    exit 0
    ;;
esac
if [ "${PORT}" -lt 1 ] || [ "${PORT}" -gt 65535 ]; then
  echo '{"success":false,"error":"Port out of range"}'
  exit 0
fi

case "${BIND_IP}" in
  '')
    BIND_IP='::'
    ;;
  '0.0.0.0'|'::') ;;
  *)
    echo '{"success":false,"error":"Invalid bind_ip"}'
    exit 0
    ;;
esac

echo "${PORT}" > "${PORT_FILE}" || {
  echo '{"success":false,"error":"Failed to write port"}'
  exit 0
}

echo "${BIND_IP}" > "${BIND_IP_FILE}" || {
  echo '{"success":false,"error":"Failed to write bind_ip"}'
  exit 0
}

echo "${DEFAULT_SOURCE_ENABLED}" > "${SOURCE_ENABLED_FILE}" || {
  echo '{"success":false,"error":"Failed to write default source flag"}'
  exit 0
}

echo "${SOURCE_AUTO_UPDATE_ENABLED}" > "${SOURCE_AUTO_UPDATE_FILE}" || {
  echo '{"success":false,"error":"Failed to write auto update flag"}'
  exit 0
}

if [ -n "${PASSWORD}" ]; then
  printf '%s' "${PASSWORD}" > "${PASSWORD_FILE}" || {
    echo '{"success":false,"error":"Failed to write password"}'
    exit 0
  }
  chmod 600 "${PASSWORD_FILE}" >/dev/null 2>&1
fi

SYNOPKG_PKGNAME="${PKG_NAME}"
SYNOPKG_PKGDEST="${TARGET_DIR}"
CTL_SCRIPT="${PKG_BASE}/scripts/start-stop-status"
export SYNOPKG_PKGNAME SYNOPKG_PKGDEST
{
  echo "[$(date '+%F %T')] apply.cgi: requested restart (port=${PORT}, bind_ip=${BIND_IP}, default_source_enabled=${DEFAULT_SOURCE_ENABLED}, source_auto_update_enabled=${SOURCE_AUTO_UPDATE_ENABLED})"
} >>"${RESTART_LOG}" 2>&1

nohup sh -c "echo '[`date '+%F %T'`]' apply.cgi: stop && ${CTL_SCRIPT} stop && echo '[`date '+%F %T'`]' apply.cgi: start && ${CTL_SCRIPT} start && echo '[`date '+%F %T'`]' apply.cgi: done" >>"${RESTART_LOG}" 2>&1 &

echo '{"success":true}'
exit 0
