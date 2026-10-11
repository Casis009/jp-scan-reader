import type { Analysis } from '../prompts/schema'

/** 방금 분석한 결과. 5단계에서 IndexedDB 기록으로 옮기기 전까지 메모리에만 둔다. */
export interface SessionResult {
  analysis: Analysis
  raw: string
  image: Blob | null
  source: string
}

let latest: SessionResult | null = null

export function setLatestResult(result: SessionResult) {
  latest = result
}

export function getLatestResult(): SessionResult | null {
  return latest
}
