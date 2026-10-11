import type { ThinkingLevel } from './db'

export interface ModelPreset {
  id: string
  label: string
  thinking: ThinkingLevel[]
}

// 2026-10-12 공식 문서(models, pricing, thinking) 기준 무료 티어에서 쓸 수 있는 이미지 입력 모델.
// gemini-3.1-flash-lite는 문서에 생각 수준 목록이 없어 공통으로 쓰이는 LOW/MEDIUM/HIGH만 둔다.
export const MODEL_PRESETS: ModelPreset[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', thinking: ['LOW', 'MEDIUM', 'HIGH'] },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', thinking: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', thinking: ['LOW', 'MEDIUM', 'HIGH'] },
]

const FALLBACK_THINKING: ThinkingLevel[] = ['LOW', 'MEDIUM', 'HIGH']

export function thinkingLevelsFor(model: string): ThinkingLevel[] {
  return MODEL_PRESETS.find((m) => m.id === model)?.thinking ?? FALLBACK_THINKING
}

/** 모델이 지원하지 않는 수준이면 LOW(없으면 첫 수준)로 바꾼다. */
export function effectiveThinkingLevel(model: string, level: ThinkingLevel): ThinkingLevel {
  const supported = thinkingLevelsFor(model)
  if (supported.includes(level)) return level
  return supported.includes('LOW') ? 'LOW' : supported[0]
}

/** 목록에서 다음 모델(끝이면 처음). 목록에 없는 모델(직접 입력)이면 첫 모델. */
export function nextModel(current: string): ModelPreset {
  const i = MODEL_PRESETS.findIndex((m) => m.id === current)
  return MODEL_PRESETS[(i + 1) % MODEL_PRESETS.length]
}

export function modelLabel(id: string): string {
  return MODEL_PRESETS.find((m) => m.id === id)?.label ?? id
}
