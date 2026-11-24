import { AsyncLocalStorage } from 'node:async_hooks'

const requests = new AsyncLocalStorage<AbortSignal>()
export const sourceRequestSignal = () => requests.getStore()

export async function withSourceRequestSignal<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  if (!signal) return run()
  const cancelled = () => signal.reason || Object.assign(new Error('Source request cancelled'), { name: 'AbortError' })
  if (signal.aborted) throw cancelled()
  return requests.run(signal, async () => {
    let abort: () => void = () => {}
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled())
      signal.addEventListener('abort', abort, { once: true })
    })
    try { return await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw cancelled()
      return run()
    }), stopped]) }
    finally { signal.removeEventListener('abort', abort) }
  })
}
