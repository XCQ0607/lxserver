export const validateUsername = (username: unknown): string => {
  if (typeof username !== 'string') throw new Error('Invalid username')

  const value = username.trim()
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value)) {
    throw new Error('Invalid username')
  }
  return value
}

export const normalizeUsername = (username: unknown): string => validateUsername(username).toLowerCase()

export const tryNormalizeUsername = (username: unknown): string | null => {
  try {
    return normalizeUsername(username)
  } catch {
    return null
  }
}
