'use client'

const CACHE_PREFIX = 'ascent_cache_'
const DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes

type CacheEntry<T> = {
  data: T
  timestamp: number
}

export function setCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() }
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // storage full or unavailable
  }
}

export function getCache<T>(key: string, ttl = DEFAULT_TTL): T | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (Date.now() - entry.timestamp > ttl) {
      sessionStorage.removeItem(CACHE_PREFIX + key)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

export function clearCache(key: string): void {
  try {
    sessionStorage.removeItem(CACHE_PREFIX + key)
  } catch {
    // ignore
  }
}
