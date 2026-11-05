/** Resolve collection ownership from authenticated identity, never a display name. */
export function resolveCollectionUser(requested: string, verified: string | null, admin: boolean, allowOpen: boolean, write: boolean): string | null {
  if (requested === '_open' || (!requested && !verified)) {
    return allowOpen && (!write || admin) ? '_open' : null
  }
  if (admin && requested) return requested
  if (requested && requested !== verified) return null
  return verified
}
