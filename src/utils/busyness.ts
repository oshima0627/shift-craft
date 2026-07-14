import type { AppData, BusynessLevel } from '../types'

/** その日の忙しさ段階ID（未設定日は既定段階）。存在しないIDは既定/先頭にフォールバック */
export function busynessIdOf(data: AppData, date: string): string {
  const id = data.dayBusyness[date] ?? data.defaultBusynessLevelId
  if (data.busynessLevels.some((l) => l.id === id)) return id
  if (data.busynessLevels.some((l) => l.id === data.defaultBusynessLevelId)) {
    return data.defaultBusynessLevelId
  }
  return data.busynessLevels[0]?.id ?? ''
}

/** その日の忙しさ段階（オブジェクト） */
export function busynessOf(data: AppData, date: string): BusynessLevel | undefined {
  const id = busynessIdOf(data, date)
  return data.busynessLevels.find((l) => l.id === id)
}
