const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync, spawnSync } = require('child_process');
const unzipper = require('unzipper');

/**
 * 自动下载 Chromaprint fpcalc 二进制文件
 * 目标目录: /public/music/bin/
 */

const TARGET_DIR = path.join(__dirname, '../public/music/bin');
const GITHUB_RELEASES_URL = 'https://github.com/acoustid/chromaprint/releases/latest';

const PLATFORMS = [
    { id: 'win-x64', platform: 'win32', arch: 'x64', fileNamePart: 'windows-x86_64.zip', target: 'fpcalc-win-x64.exe' },
    { id: 'linux-x64', platform: 'linux', arch: 'x64', fileNamePart: 'linux-x86_64.tar.gz', target: 'fpcalc-linux-x64' },
    { id: 'linux-arm64', platform: 'linux', arch: 'arm64', fileNamePart: 'linux-arm64.tar.gz', target: 'fpcalc-linux-arm64' },
    { id: 'linux-arm', platform: 'linux', arch: 'arm', fileNamePart: 'linux-armhf.tar.gz', target: 'fpcalc-linux-arm' },
    { id: 'macos', platform: 'darwin', arch: 'any', fileNamePart: 'macos-universal.tar.gz', target: 'fpcalc-macos' },
];

// 获取最新版本号
function getLatestVersion() {
    return new Promise((resolve, reject) => {
        https.get(GITHUB_RELEASES_URL, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                const location = res.headers.location;
                const versionMatch = location.match(/tag\/(v[\d.]+)/);
                if (versionMatch) {
                    resolve(versionMatch[1]);
                } else {
                    reject(new Error('无法解析最新版本号: ' + location));
                }
            } else {
                reject(new Error('获取最新版本失败，状态码: ' + res.statusCode));
            }
        }).on('error', reject);
    });
}

// 下载文件
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                downloadFile(res.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`下载失败，状态码: ${res.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve());
            });
            file.on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        }).on('error', reject);
    });
}

async function extractZip(filePath, destDir) {
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(unzipper.Extract({ path: destDir }))
            .on('close', resolve)
            .on('error', reject);
    });
}

/**
 * 递归查找文件名
 */
function findFile(dir, fileName) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            const found = findFile(fullPath, fileName);
            if (found) return found;
        } else if (file === fileName || (file === 'fpcalc.exe' && fileName === 'fpcalc')) {
            return fullPath;
        }
    }
    return null;
}

async function downloadPlatform(platformInfo, version, customTargetName) {
    const v = version.replace('v', '');
    const fileName = `chromaprint-fpcalc-${v}-${platformInfo.fileNamePart}`;
    const downloadUrl = `https://github.com/acoustid/chromaprint/releases/download/${version}/${fileName}`;
    const tempFilePath = path.join(TARGET_DIR, `temp-${platformInfo.id}-${fileName}`);

    console.log(`正在下载 [${platformInfo.id}]: ${fileName}...`);
    await downloadFile(downloadUrl, tempFilePath);

    const tempDir = path.join(TARGET_DIR, `extract-${platformInfo.id}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    if (fileName.endsWith('.zip')) {
        await extractZip(tempFilePath, tempDir);
    } else {
        execSync(`tar -xzf "${tempFilePath}" -C "${tempDir}"`);
    }

    const binaryBaseName = platformInfo.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc';
    const fpcalcPath = findFile(tempDir, binaryBaseName);

    if (fpcalcPath) {
        const targetName = customTargetName || platformInfo.target;
        const finalPath = path.join(TARGET_DIR, targetName);
        fs.renameSync(fpcalcPath, finalPath);
        if (platformInfo.platform !== 'win32') {
            fs.chmodSync(finalPath, '755');
        }
        console.log(`成功安装: ${targetName}`);
    } else {
        throw new Error(`在解压后的文件中未找到 ${binaryBaseName}`);
    }

    // 清理
    fs.unlinkSync(tempFilePath);
    fs.rmSync(tempDir, { recursive: true, force: true });
}

async function main() {
    const isAll = process.argv.includes('--all');

    try {
        if (!isAll) {
            // 环境检查：如果不是下载所有，则检查当前平台
            const platform = os.platform();
            const genericName = platform === 'win32' ? 'fpcalc.exe' : 'fpcalc';
            if (fs.existsSync(path.join(TARGET_DIR, genericName))) {
                console.log(`检测到 ${genericName} 已存在，跳过自动下载。`);
                return;
            }
            const checkGlobal = spawnSync(platform === 'win32' ? 'where' : 'which', ['fpcalc'], { encoding: 'utf8' });
            if (checkGlobal.status === 0) {
                console.log('检测到系统中已安装 fpcalc，跳过自动下载。');
                return;
            }
        }

        if (!fs.existsSync(TARGET_DIR)) {
            fs.mkdirSync(TARGET_DIR, { recursive: true });
        }

        console.log('正在查询最新版本...');
        const version = await getLatestVersion();
        console.log(`最新版本: ${version}`);

        if (isAll) {
            console.log('模式: 下载所有平台二进制文件');
            for (const p of PLATFORMS) {
                try {
                    await downloadPlatform(p, version); // 使用默认的平台特定名称
                } catch (err) {
                    console.error(`下载 ${p.id} 失败: ${err.message}`);
                }
            }
        } else {
            const platform = os.platform();
            const arch = os.arch();
            const p = PLATFORMS.find(item => item.platform === platform && (item.arch === 'any' || item.arch === arch));
            if (p) {
                // 单平台下载：使用通用名称 (fpcalc.exe / fpcalc)
                const genericName = platform === 'win32' ? 'fpcalc.exe' : 'fpcalc';
                await downloadPlatform(p, version, genericName);
            } else {
                console.log(`未找到匹配当前平台 (${platform}-${arch}) 的预编译文件。`);
            }
        }

        console.log('任务完成！');

    } catch (error) {
        console.error('任务失败:', error.message);
        process.exit(1);
    }
}

main();
