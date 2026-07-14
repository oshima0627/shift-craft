/**
 * 日本の祝日を計算する（2000年以降の現行法に対応）。
 * 固定日・ハッピーマンデー・春分秋分・振替休日・国民の休日を含む。
 * 祝日入力なしで自動判定するために使う。
 */

const cache = new Map<number, Set<string>>()

function key(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 月(1-12)の第n月曜の日付(1-31) */
function nthMonday(year: number, month: number, n: number): number {
  const firstDow = new Date(year, month - 1, 1).getDay() // 0=日
  const firstMonday = 1 + ((8 - firstDow) % 7)
  return firstMonday + (n - 1) * 7
}

/** 春分の日（2000-2099） */
function vernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}
/** 秋分の日（2000-2099） */
function autumnEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

function computeYear(year: number): Set<string> {
  // date文字列 -> 祝日名
  const holidays = new Map<string, string>()
  const add = (month: number, day: number, name: string) => holidays.set(key(year, month, day), name)

  // 固定日
  add(1, 1, '元日')
  add(2, 11, '建国記念の日')
  if (year >= 2020) add(2, 23, '天皇誕生日')
  add(4, 29, '昭和の日')
  add(5, 3, '憲法記念日')
  add(5, 4, 'みどりの日')
  add(5, 5, 'こどもの日')
  add(8, 11, '山の日')
  add(11, 3, '文化の日')
  add(11, 23, '勤労感謝の日')
  // ハッピーマンデー
  add(1, nthMonday(year, 1, 2), '成人の日')
  add(7, nthMonday(year, 7, 3), '海の日')
  add(9, nthMonday(year, 9, 3), '敬老の日')
  add(10, nthMonday(year, 10, 2), 'スポーツの日')
  // 春分・秋分
  add(3, vernalEquinox(year), '春分の日')
  add(9, autumnEquinox(year), '秋分の日')

  const has = (y: number, m: number, d: number) => holidays.has(key(y, m, d))
  const dateAt = (offsetFrom: string, delta: number) => {
    const [y, m, d] = offsetFrom.split('-').map(Number)
    const dt = new Date(y, m - 1, d + delta)
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), dow: dt.getDay() }
  }

  // 国民の休日（前後が祝日で挟まれた平日）
  const base = [...holidays.keys()]
  for (const k of base) {
    const next = dateAt(k, 1)
    // k と k+2 が祝日で、k+1 が祝日でない → k+1 を国民の休日に
    const after2 = dateAt(k, 2)
    if (
      has(after2.y, after2.m, after2.d) &&
      !has(next.y, next.m, next.d) &&
      next.dow !== 0
    ) {
      holidays.set(key(next.y, next.m, next.d), '国民の休日')
    }
  }

  // 振替休日（祝日が日曜 → 次の非祝日を振替休日に）
  for (const k of [...holidays.keys()]) {
    const [y, m, d] = k.split('-').map(Number)
    if (new Date(y, m - 1, d).getDay() !== 0) continue // 日曜のみ
    let delta = 1
    for (;;) {
      const c = dateAt(k, delta)
      if (!has(c.y, c.m, c.d)) {
        holidays.set(key(c.y, c.m, c.d), '振替休日')
        break
      }
      delta++
    }
  }

  return new Set(holidays.keys())
}

function yearSet(year: number): Set<string> {
  let s = cache.get(year)
  if (!s) {
    s = computeYear(year)
    cache.set(year, s)
  }
  return s
}

/** その日が日本の祝日か（"yyyy-MM-dd"） */
export function isJapaneseHoliday(dateStr: string): boolean {
  const year = Number(dateStr.slice(0, 4))
  if (!Number.isFinite(year)) return false
  return yearSet(year).has(dateStr)
}
