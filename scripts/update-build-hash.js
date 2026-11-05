const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getDirectoryHash(dir, exclude = [], extensions = []) {
    const files = [];

    function readDir(currentDir) {
        if (!fs.existsSync(currentDir)) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.relative(dir, fullPath).replace(/\\/g, '/'); // normalize slashes for exclude array

            // exclude matches
            if (exclude.some(ex => relPath.startsWith(ex) || entry.name === ex)) {
                continue;
            }

            if (entry.isDirectory()) {
                readDir(fullPath);
            } else if (entry.isFile()) {
                if (extensions.length === 0 || extensions.some(ext => entry.name.endsWith(ext))) {
                    files.push(fullPath);
                }
            }
        }
    }

    readDir(dir);

    // Sort files to ensure stable hash
    files.sort();

    const hash = crypto.createHash('md5');
    for (const file of files) {
        const content = fs.readFileSync(file);
        const ext = path.extname(file).toLowerCase();
        const textExtensions = ['.js', '.ts', '.json', '.html', '.css', '.md', '.svg', '.txt', '.cjs', '.mjs', '.xml', '.yaml', '.yml'];

        if (textExtensions.includes(ext)) {
            // 统一将 CRLF 转换为 LF 再计算 Hash，确保跨平台一致性
            const text = content.toString('utf8').replace(/\r\n/g, '\n');
            hash.update(text);
        } else {
            hash.update(content);
        }
    }

    return hash.digest('hex');
}

const targetDir = path.resolve(__dirname, '../');
const packageVersion = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')).version;
if (typeof packageVersion !== 'string' || !packageVersion.trim()) {
    throw new Error('package.json must contain a version');
}
const version = 'v' + packageVersion.trim().replace(/^v/i, '');

// We exclude config.js/about.md itself to avoid infinite hash changes when injecting the hash.
// Also ignore logs, data, server (dist), node_modules, .git.
const publicHash = getDirectoryHash(path.join(targetDir, 'public'), ['js/config.js', 'about.md', 'music/about.md', 'music/bin'], []);
const srcHash = getDirectoryHash(path.join(targetDir, 'src'), [], []);

const finalHash = crypto.createHash('md5').update(version + publicHash + srcHash).digest('hex').substring(0, 7);

// Update config.js
const configPath = path.join(targetDir, 'public', 'js', 'config.js');
if (fs.existsSync(configPath)) {
    let configContent = fs.readFileSync(configPath, 'utf8');

    if (/\bversion['"]?\s*:/.test(configContent)) {
        configContent = configContent.replace(/(\bversion['"]?\s*:)\s*['"][^'"]*['"]/, `$1 '${version}'`);
    } else {
        configContent = configContent.replace(/(window\.CONFIG\s*=\s*\{)/, `$1\n    version: '${version}',`);
    }

    if (/\bbuildHash['"]?\s*:/.test(configContent)) {
        configContent = configContent.replace(/(\bbuildHash['"]?\s*:)\s*['"][^'"]*['"]/, `$1 '${finalHash}'`);
    } else {
        configContent = configContent.replace(/(window\.CONFIG\s*=\s*\{)/, `$1\n    buildHash: '${finalHash}',`);
    }

    fs.writeFileSync(configPath, configContent);
    console.log(`Build info updated to ${version} (${finalHash}) in config.js`);
}
