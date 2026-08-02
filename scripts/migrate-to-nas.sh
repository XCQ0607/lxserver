#!/bin/bash
# lxserver 迁移到飞牛 NAS 辅助脚本
# 用法: bash scripts/migrate-to-nas.sh [输出目录]
# 默认输出到 /tmp/opencode/nas-deploy/
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-/tmp/opencode/nas-deploy}"
TARBALL="${OUT_DIR}/lxserver-nas-deploy.tar.gz"

if [ ! -d "${PROJECT_DIR}/data" ]; then
  echo "错误: 未找到 ${PROJECT_DIR}/data 目录"
  exit 1
fi

mkdir -p "${OUT_DIR}"

# 1. 生成清洗后的 config.js（移除 users 的本地绝对 dataPath，NAS 上由系统重建）
echo "[1/3] 生成 NAS 用 config.js ..."
python3 - "${PROJECT_DIR}/config.js" "${OUT_DIR}/config.js" <<'PY'
import json, re, sys

src, dst = sys.argv[1], sys.argv[2]
with open(src, 'r', encoding='utf-8') as f:
    raw = f.read()

# config.js 是 module.exports = {...}，提取对象文本
m = re.search(r'module\.exports\s*=\s*(\{.*\})\s*$', raw, re.S)
if not m:
    # 兜底：直接复制
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(raw)
    sys.exit(0)

obj_text = m.group(1)
try:
    obj = json.loads(obj_text)
except Exception:
    # 含注释/单引号等 JSON5 风格，直接复制
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(raw)
    sys.exit(0)

# 清空每个用户的 dataPath，NAS 上由服务器按用户名重建
for u in obj.get('users', []):
    u['dataPath'] = ''

with open(dst, 'w', encoding='utf-8') as f:
    f.write('module.exports = ')
    f.write(json.dumps(obj, ensure_ascii=False, indent=2))
    f.write('\n')
print('    config.js 已生成, 共', len(obj.get('users', [])), '个用户')
PY

# 2. 复制整个 data 目录
echo "[2/3] 打包 data/ 目录 ..."
STAGE="${OUT_DIR}/data"
rm -rf "${STAGE}"
mkdir -p "${STAGE}"
cp -a "${PROJECT_DIR}/data/." "${STAGE}/"

# 3. 打包
echo "[3/3] 生成部署包 ..."
cd "${OUT_DIR}"
tar -czf "${TARBALL}" config.js data
echo ""
echo "==== 部署包已生成: ${TARBALL} ===="
echo ""
echo "==== NAS 侧安装步骤 ===="
echo "1. 将 ${TARBALL} 上传到 NAS，并解压到项目目录:"
echo "   mkdir -p /vol1/docker/lxserver && tar -xzf lxserver-nas-deploy.tar.gz -C /vol1/docker/lxserver"
echo ""
echo "2. 将项目代码（Dockerfile / docker-compose.yml / src / public 等）放到同一目录"
echo ""
echo "3. 修改 docker-compose.yml 映射端口后启动:"
echo "   cd /vol1/docker/lxserver && docker compose up -d --build"
echo ""
echo "4. 访问:"
echo "   后台:  http://<NAS-IP>:9527/"
echo "   播放器: http://<NAS-IP>:9527/music/"
echo ""
echo "==== 环境变量可选覆盖（docker-compose.yml 中配置，优先级高于 config.js）===="
echo "   LX_USER_用户名=密码         # 追加/覆盖用户"
echo "   WEBPLAYER_PASSWORD=密码     # 播放器访问密码"
echo "   ENABLE_WEBPLAYER_AUTH=true  # 开启播放器密码验证"
