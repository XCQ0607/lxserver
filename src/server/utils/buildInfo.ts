import fs from 'node:fs'
import path from 'node:path'

/** Package version is authoritative; the generated public config identifies the source build. */
export const getBuildInfo = (staticPath: string, packagePath = path.resolve(__dirname, '../../../package.json')) => {
  let version = 'unknown'
  let buildHash = 'unknown'
  let staticVersion = ''
  try {
    const content = fs.readFileSync(path.join(staticPath, 'js/config.js'), 'utf8')
    staticVersion = content.match(/\bversion['"]?\s*:\s*['"]([^'"]+)['"]/)?.[1] || ''
    buildHash = content.match(/\bbuildHash['"]?\s*:\s*['"]([a-f0-9]{7,64})['"]/i)?.[1] || 'unknown'
  } catch { }
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    if (typeof pkg.version === 'string' && pkg.version.trim()) version = pkg.version.trim()
  } catch { }
  if (version === 'unknown') version = staticVersion || version
  if (version !== 'unknown') version = 'v' + version.replace(/^v/i, '')
  return { version, buildHash }
}
