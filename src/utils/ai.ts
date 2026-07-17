import type { ParsedRule, ShiftType, Staff } from '../types'

/**
 * AI（Claude）による自由文条件の解釈クライアント。
 * 実際のAPI呼び出しは Cloudflare Worker（/api/ai/parse-rule）が行い、
 * APIキーはサーバー側のシークレットで保持する（フロントには置かない）。
 */

export interface AiModelOption {
  id: string
  label: string
  hint: string
}

/** 切り替え可能なモデル（サーバーの許可リストと一致させること）。先頭が既定 */
export const AI_MODELS: AiModelOption[] = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: '高速・低コスト（既定）' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: '高精度（複雑な条件に強い）' },
]

const MODEL_KEY = 'shiftcraft-ai-model'

export function getSelectedModel(): string {
  try {
    const v = localStorage.getItem(MODEL_KEY)
    if (v && AI_MODELS.some((m) => m.id === v)) return v
  } catch {
    // localStorage 不可の環境では既定を使う
  }
  return AI_MODELS[0].id
}

export function setSelectedModel(model: string): void {
  try {
    localStorage.setItem(MODEL_KEY, model)
  } catch {
    // 保存できなくても致命的ではない
  }
}

export interface AiParseResponse {
  parsed: ParsedRule | null
  description: string
}

export type AiParseOutcome =
  | { ok: true; result: AiParseResponse; remaining?: number; limit?: number }
  /** kind: not_configured=キー未設定 / unauthorized=未ログイン / limit=回数上限 / failed=通信/実行エラー */
  | { ok: false; kind: 'not_configured' | 'unauthorized' | 'failed' }
  | { ok: false; kind: 'limit'; tier: string; limit: number }

/** 自由文条件をAIで解釈して1つの構造化ルール（または null）を得る */
export async function aiParseRule(
  text: string,
  staff: Staff[],
  shifts: ShiftType[],
  model: string,
): Promise<AiParseOutcome> {
  try {
    const res = await fetch('/api/ai/parse-rule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model,
        staff: staff.map((s) => ({ id: s.id, name: s.name })),
        shifts: shifts.map((s) => ({ id: s.id, name: s.name })),
      }),
    })
    if (res.status === 501) return { ok: false, kind: 'not_configured' }
    if (res.status === 401) return { ok: false, kind: 'unauthorized' }
    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as
        | { tier?: string; limit?: number }
        | null
      return { ok: false, kind: 'limit', tier: body?.tier ?? 'trialing', limit: body?.limit ?? 0 }
    }
    if (!res.ok) {
      return { ok: false, kind: 'failed' }
    }
    const result = (await res.json()) as AiParseResponse & { aiRemaining?: number; aiLimit?: number }
    return { ok: true, result, remaining: result.aiRemaining, limit: result.aiLimit }
  } catch {
    return { ok: false, kind: 'failed' }
  }
}
