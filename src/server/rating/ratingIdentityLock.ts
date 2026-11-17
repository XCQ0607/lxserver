/** 串行化同一用户的关联变更与评分写入；独立于元数据锁，固定先身份锁后元数据锁。 */
const pending = new Map<string, Promise<unknown>>()
export function withRatingIdentityLock<T>(user: string, task: () => Promise<T>): Promise<T> {
  const previous = pending.get(user) || Promise.resolve()
  const result = previous.then(task, task)
  const tail = result.then(() => undefined, () => undefined)
  pending.set(user, tail)
  void tail.then(() => { if (pending.get(user) === tail) pending.delete(user) })
  return result
}
