import type { ParsedRule, ShiftType, Staff } from '../types'

/**
 * 自然文のカスタム条件をルールベース（AI不使用）で構造化ルールに解釈する。
 *
 * 対応パターン（例）:
 *  - 「田中と佐藤は同じ日に入れない」            → pairAvoid
 *  - 「高橋と田中はなるべく同じ日に入れる」      → pairTogether
 *  - 「鈴木は火曜は休み」「鈴木は火曜に入れない」 → forbidWeekday
 *  - 「伊藤は遅番に入れない」                    → forbidShift
 *  - 「高橋は早番のみ」                          → onlyShift
 *  - 「佐藤は週3日まで」                          → maxDaysPerWeek
 *  - 「田中は4連勤まで」                          → maxConsecutive
 *  - 「田中は金曜は早番固定」                     → fixWeekdayShift
 *
 * ここで解釈できない自由文は「メモ」として保持される。
 * さらに複雑な自然文の構造化は LLM 連携が有効な領域（docs/research.md 参照）。
 */

export interface ParseResult {
  parsed: ParsedRule | null
  /** 解釈内容の日本語説明（parsed=null のときは理由） */
  description: string
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 全角数字を半角に */
function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .replace(/さん|くん|君|氏/g, '')
}

/** テキスト中に現れるスタッフを出現位置順に返す */
function findStaff(text: string, staff: Staff[]): { staff: Staff; index: number }[] {
  const hits: { staff: Staff; index: number }[] = []
  for (const s of staff) {
    if (!s.name) continue
    const idx = text.indexOf(s.name)
    if (idx >= 0) hits.push({ staff: s, index: idx })
  }
  return hits.sort((a, b) => a.index - b.index)
}

function findShift(text: string, shifts: ShiftType[]): ShiftType | null {
  let best: ShiftType | null = null
  let bestLen = 0
  for (const sh of shifts) {
    if (sh.name && text.includes(sh.name) && sh.name.length > bestLen) {
      best = sh
      bestLen = sh.name.length
    }
  }
  return best
}

function findWeekday(text: string): number | null {
  const m = text.match(/([日月火水木金土])曜/)
  if (!m) return null
  return WEEKDAYS.indexOf(m[1])
}

export function parseRule(rawText: string, staff: Staff[], shifts: ShiftType[]): ParseResult {
  const text = normalize(rawText)
  if (!text) return { parsed: null, description: '条件を入力してください。' }

  const people = findStaff(text, staff)
  const shift = findShift(text, shifts)
  const weekday = findWeekday(text)

  // --- 2人が主語のルール ---
  if (people.length >= 2) {
    const [a, b] = people
    if (/同じ日に(入れない|出勤させない|しない|入らない)|一緒に(しない|入れない)|(分ける|離す)/.test(text)) {
      return {
        parsed: { kind: 'pairAvoid', a: a.staff.id, b: b.staff.id },
        description: `${a.staff.name} と ${b.staff.name} を同じ日に出勤させない（ハード制約）`,
      }
    }
    if (/同じ日に(入れる|出勤|する)|一緒に(入れる|する|出勤)/.test(text)) {
      return {
        parsed: { kind: 'pairTogether', a: a.staff.id, b: b.staff.id },
        description: `${a.staff.name} と ${b.staff.name} をなるべく同じ日に出勤させる（ソフト制約）`,
      }
    }
  }

  // --- 1人が主語のルール ---
  if (people.length >= 1) {
    const p = people[0].staff

    // 週N日まで
    const mWeek = text.match(/週(\d+)日(まで|以内)/)
    if (mWeek) {
      const days = Number(mWeek[1])
      return {
        parsed: { kind: 'maxDaysPerWeek', staffId: p.id, days },
        description: `${p.name} は週${days}日まで（ハード制約）`,
      }
    }

    // N連勤まで
    const mCons = text.match(/(\d+)連勤(まで|以内)/)
    if (mCons) {
      const days = Number(mCons[1])
      return {
        parsed: { kind: 'maxConsecutive', staffId: p.id, days },
        description: `${p.name} は${days}連勤まで（ハード制約）`,
      }
    }

    // ○曜は△△固定
    if (weekday != null && shift && /(固定|に入れる|担当)/.test(text)) {
      return {
        parsed: { kind: 'fixWeekdayShift', staffId: p.id, weekday, shiftId: shift.id },
        description: `${p.name} は${WEEKDAYS[weekday]}曜は「${shift.name}」を優先し、他の時間帯には入れない`,
      }
    }

    // ○曜は休み・入れない
    if (weekday != null && /(休み|休む|入れない|出勤できない|不可|NG)/i.test(text)) {
      return {
        parsed: { kind: 'forbidWeekday', staffId: p.id, weekday },
        description: `${p.name} は${WEEKDAYS[weekday]}曜に入れない（ハード制約）`,
      }
    }

    // シフト名 + のみ/だけ
    if (shift && /(のみ|だけ|限定)/.test(text)) {
      return {
        parsed: { kind: 'onlyShift', staffId: p.id, shiftId: shift.id },
        description: `${p.name} は「${shift.name}」のみに入れる（ハード制約）`,
      }
    }

    // シフト名 + 入れない/NG
    if (shift && /(入れない|不可|NG|できない|無理)/i.test(text)) {
      return {
        parsed: { kind: 'forbidShift', staffId: p.id, shiftId: shift.id },
        description: `${p.name} は「${shift.name}」に入れない（ハード制約）`,
      }
    }
  }

  // 解釈失敗の理由を具体的に
  if (people.length === 0) {
    return {
      parsed: null,
      description:
        '登録済みスタッフの名前が見つかりませんでした。メモとして保存します（生成時に表示）。',
    }
  }
  return {
    parsed: null,
    description:
      'この文は自動解釈できませんでした。メモとして保存します（生成時に表示）。複雑な条件の自動解釈はLLM連携で拡張可能です。',
  }
}

/** ParsedRule の日本語説明（一覧表示用） */
export function describeRule(
  rule: ParsedRule,
  staff: Staff[],
  shifts: ShiftType[],
): string {
  const name = (id: string) => staff.find((s) => s.id === id)?.name ?? '(不明)'
  const shiftName = (id: string) => shifts.find((s) => s.id === id)?.name ?? '(不明)'
  switch (rule.kind) {
    case 'pairAvoid':
      return `${name(rule.a)} ✕ ${name(rule.b)}：同じ日に入れない`
    case 'pairTogether':
      return `${name(rule.a)} ♡ ${name(rule.b)}：なるべく同じ日に`
    case 'forbidWeekday':
      return `${name(rule.staffId)}：${WEEKDAYS[rule.weekday]}曜は入れない`
    case 'forbidShift':
      return `${name(rule.staffId)}：「${shiftName(rule.shiftId)}」に入れない`
    case 'onlyShift':
      return `${name(rule.staffId)}：「${shiftName(rule.shiftId)}」のみ`
    case 'maxDaysPerWeek':
      return `${name(rule.staffId)}：週${rule.days}日まで`
    case 'maxConsecutive':
      return `${name(rule.staffId)}：${rule.days}連勤まで`
    case 'fixWeekdayShift':
      return `${name(rule.staffId)}：${WEEKDAYS[rule.weekday]}曜は「${shiftName(rule.shiftId)}」固定`
  }
}
