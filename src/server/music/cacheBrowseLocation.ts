import { AsyncLocalStorage } from 'node:async_hooks'

const browseLocation = new AsyncLocalStorage<'root' | 'data' | undefined>()

// Browsing must never update the user's persistent cache/download destination.
export const getCacheBrowseLocation = () => browseLocation.getStore()

export const withCacheBrowseLocation = <T>(requestUrl: string, callback: () => T): T => {
  if (!requestUrl.startsWith('/api/music/cache/') && !requestUrl.startsWith('/api/music/remaster/start?') && !requestUrl.startsWith('/api/music/auto-link/')) {
    return browseLocation.run(undefined, callback)
  }
  const url = new URL(requestUrl, 'http://localhost')
  const location = url.searchParams.get('browseLocation')
  const isBrowseRequest = url.pathname.startsWith('/api/music/auto-link/') || url.pathname === '/api/music/remaster/start' ||
    (url.pathname.startsWith('/api/music/cache/') &&
      !['/api/music/cache/config', '/api/music/cache/rename'].includes(url.pathname))
  return browseLocation.run(isBrowseRequest && (location === 'root' || location === 'data') ? location : undefined, callback)
}
