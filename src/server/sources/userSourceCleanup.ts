import fs from 'node:fs'
import path from 'node:path'

/** Only remove a private source directory; never the shared _open directory. */
export function deleteUserSourceFiles(username: string): void {
  if (!username || username === '_open' || username === 'open' || username === '.' || username === '..' || /[\\/:]/.test(username)) {
    throw new Error('Invalid private source owner')
  }
  const root = path.resolve(process.env.DATA_PATH || path.join(process.cwd(), 'data'), 'users', 'source')
  const target = path.resolve(root, username)
  if (path.dirname(target) !== root) throw new Error('Invalid private source directory')
  fs.rmSync(target, { recursive: true, force: true })
}
