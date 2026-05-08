#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${SCRIPT_DIR}/.spk-build"
SPK_META_DIR="${SCRIPT_DIR}/spk"
OUTPUT_DIR="${SCRIPT_DIR}/dist/spk"
SOURCE_DIR="${WORK_DIR}/lxserver-src"
TARGET_ARCH_TAG="${TARGET_ARCH_TAG:-$(uname -m)}"

LXSERVER_REPO="${LXSERVER_REPO:-https://github.com/XCQ0607/lxserver.git}"
LXSERVER_REF="${LXSERVER_REF:-main}"
LXSERVER_LOCAL_DIR="${LXSERVER_LOCAL_DIR:-}"

PKG_NAME="lxserver"
SPK_VERSION_OVERRIDE="${SPK_VERSION_OVERRIDE:-}"

need_cmd() {
  local name="$1"
  if command -v "${name}" >/dev/null 2>&1; then
    return 0
  fi
  echo "错误: 未找到命令「${name}」。请先安装后再试。" >&2
  if [ "${name}" = "node" ] || [ "${name}" = "npm" ]; then
    echo "Ubuntu / Debian 示例：" >&2
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -" >&2
    echo "  sudo apt-get update && sudo apt-get install -y nodejs" >&2
  fi
  exit 1
}

normalize_lf() {
  local file="$1"
  # Remove CR characters to avoid DSM script execution failures.
  perl -pi -e 's/\r$//' "${file}"
}

need_cmd git
need_cmd node
need_cmd npm
need_cmd tar
need_cmd perl

NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
if [ "${NODE_MAJOR}" -lt 16 ]; then
  echo "错误: Node 版本需 >= 16，当前: $(node -v)" >&2
  exit 1
fi

ARCH="$(uname -m)"
echo "==> 构建机架构: ${ARCH}（应与群晖 CPU 架构一致）"
case "${ARCH}" in
  x86_64|amd64) echo "    适用于常见 Intel/AMD 群晖（x86_64）。" ;;
  aarch64|arm64) echo "    适用于 ARM64 群晖（aarch64）。" ;;
  armv7l|armv7) echo "    适用于老机型 ARMv7 群晖（armv7）。" ;;
  *) echo "    警告: 非常见架构，请自行确认与 NAS 一致。" ;;
esac
echo "==> 包仓库: ${SCRIPT_DIR}"
if [ -n "${LXSERVER_LOCAL_DIR}" ]; then
  echo "==> 源码目录: ${LXSERVER_LOCAL_DIR}"
else
  echo "==> 源码仓库: ${LXSERVER_REPO}"
  echo "==> 源码分支: ${LXSERVER_REF}"
fi
echo "==> Node: $(node -v), npm: $(npm -v)"
echo ""

echo "[1/8] 清理构建目录"
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}/package" "${OUTPUT_DIR}"

echo "[init] 规范换行符（强制 LF）"
normalize_lf "${SCRIPT_DIR}/build-spk.sh"
normalize_lf "${SPK_META_DIR}/ui/apply.cgi"
for script in "${SPK_META_DIR}/scripts/"*; do
  normalize_lf "${script}"
done

echo "[2/8] 准备 lxserver 源码"
if [ -n "${LXSERVER_LOCAL_DIR}" ]; then
  mkdir -p "${SOURCE_DIR}"
  tar -C "${LXSERVER_LOCAL_DIR}" \
    --exclude=".git" \
    --exclude="node_modules" \
    --exclude="packaging/synology-spk/.spk-build" \
    --exclude="packaging/synology-spk/dist" \
    -cf - . | tar -C "${SOURCE_DIR}" -xf -
else
  git clone --depth 1 --branch "${LXSERVER_REF}" "${LXSERVER_REPO}" "${SOURCE_DIR}"
fi
if [ -n "${SPK_VERSION_OVERRIDE}" ]; then
  PKG_VERSION="${SPK_VERSION_OVERRIDE}"
else
  PKG_VERSION="$(node -p "require('${SOURCE_DIR//\\/\\\\}/package.json').version")"
fi
SPK_NAME="${PKG_NAME}-${PKG_VERSION}-${TARGET_ARCH_TAG}.spk"
SPK_INFO_VERSION="${PKG_VERSION}"

echo "[init] 跳过 Electron 二进制下载（SPK 构建不需要）"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

echo "[3/8] 安装依赖（含 dev）"
cd "${SOURCE_DIR}"
npm ci

echo "[4/8] 编译产物（跳过 npm prebuild 网络下载）"
npx rimraf server
npx tsc --project tsconfig.json
npx tsc-alias -p tsconfig.json

echo "[5/8] 切换到生产依赖"
rm -rf "${SOURCE_DIR}/node_modules"
npm ci --omit=dev

echo "[6/8] 组装 package.tgz"
mkdir -p "${WORK_DIR}/app"
cp -R "${SOURCE_DIR}/server" "${WORK_DIR}/app/"
cp -R "${SOURCE_DIR}/public" "${WORK_DIR}/app/"
cp -R "${SOURCE_DIR}/node_modules" "${WORK_DIR}/app/"
cp "${SOURCE_DIR}/index.js" "${WORK_DIR}/app/"
cp "${SOURCE_DIR}/config.js" "${WORK_DIR}/app/"
cp "${SOURCE_DIR}/package.json" "${WORK_DIR}/app/"
cp -R "${SPK_META_DIR}/ui" "${WORK_DIR}/ui"
chmod +x "${WORK_DIR}/ui/apply.cgi"
tar -czf "${WORK_DIR}/package/package.tgz" -C "${WORK_DIR}" app ui

echo "[7/8] 复制 SPK 元信息"
cp "${SPK_META_DIR}/INFO" "${WORK_DIR}/package/INFO"
node -e "const fs=require('fs'); const p='${WORK_DIR}/package/INFO'; let s=fs.readFileSync(p,'utf8'); s=s.replace(/^version=\"[^\"]+\"/m, 'version=\"${SPK_INFO_VERSION}\"'); fs.writeFileSync(p,s,'utf8');"
mkdir -p "${WORK_DIR}/package/scripts" "${WORK_DIR}/package/conf"
cp -R "${SPK_META_DIR}/scripts/." "${WORK_DIR}/package/scripts/"
cp -R "${SPK_META_DIR}/conf/." "${WORK_DIR}/package/conf/"
cp "${SPK_META_DIR}/PACKAGE_ICON.PNG" "${WORK_DIR}/package/PACKAGE_ICON.PNG"
cp "${SPK_META_DIR}/PACKAGE_ICON_256.PNG" "${WORK_DIR}/package/PACKAGE_ICON_256.PNG"
cp -R "${SPK_META_DIR}/WIZARD_UIFILES" "${WORK_DIR}/package/WIZARD_UIFILES"
chmod +x "${WORK_DIR}/package/scripts/"*

echo "[8/8] 打包 SPK"
tar --format=ustar -cf "${OUTPUT_DIR}/${SPK_NAME}" \
  -C "${WORK_DIR}/package" \
  INFO PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG package.tgz scripts conf WIZARD_UIFILES
echo "完成: ${OUTPUT_DIR}/${SPK_NAME}"
