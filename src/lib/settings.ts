import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Settings } from './db'

export async function loadSettings(): Promise<Settings> {
  const rows = await db.settings.toArray()
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Settings>
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await db.settings.put({ key, value })
}

/** 아직 로드 전이면 undefined. */
export function useSettings(): Settings | undefined {
  return useLiveQuery(loadSettings)
}
