import type { JlptLevel, FuriganaMode } from './db'
import type { Analysis, Sentence, Token } from '../prompts/schema'
import { isKana, isPunctuationChar, isPunctuationOnly, toHiragana } from './kana'

export interface DisplaySentence extends Sentence {
  /** tokens로 계산한 문장 읽기(히라가나, 문장부호 제외) */
  reading: string
}

export interface DisplayAnalysis extends Omit<Analysis, 'sentences'> {
  sentences: DisplaySentence[]
}

/**
 * 모델 응답을 화면용으로 정리한다.
 * - 문장부호만 있는 문장은 앞 문장에 합친다(첫 문장이면 그대로 둔다).
 * - 문장 읽기를 tokens로 계산한다.
 */
export function prepareForDisplay(analysis: Analysis): DisplayAnalysis {
  const merged: Sentence[] = []
  for (const s of analysis.sentences) {
    const prev = merged[merged.length - 1]
    if (prev && isPunctuationOnly(s.text)) {
      merged[merged.length - 1] = { ...prev, text: prev.text + s.text, tokens: [...prev.tokens, ...s.tokens] }
    } else {
      merged.push(s)
    }
  }
  return { ...analysis, sentences: merged.map((s) => ({ ...s, reading: sentenceReading(s.tokens) })) }
}

/** ruby 조각마다 rt가 있으면 rt, 없으면 base. 가타카나는 히라가나로, 문장부호는 뺀다. 가나가 아닌 rt는 무시한다. */
export function sentenceReading(tokens: Token[]): string {
  const raw = tokens.flatMap((t) => t.ruby.map((r) => (r.rt && isKana(r.rt) ? r.rt : r.base))).join('')
  return toHiragana([...raw].filter((c) => !isPunctuationChar(c)).join(''))
}

/** 하단 시트 등에 보여 줄 수 있는 읽기인지. 가나가 아니면 숨긴다. */
export function displayableReading(reading: string | null): string | null {
  return reading && isKana(reading) ? reading : null
}

/** 사전에서 찾을 수 있는 단어 토큰인지(문장부호·〓 제외). */
export function isWordToken(t: Token): boolean {
  return t.lemma !== null
}

const RANK: Record<JlptLevel, number> = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 }

/**
 * 이 토큰에 후리가나를 보일지.
 * 'level' 모드는 학습자 수준과 같거나 더 어려운 단어, 그리고 등급 외(null) 단어에만 보인다.
 */
export function showFurigana(token: Token, mode: FuriganaMode, level: JlptLevel): boolean {
  if (mode === 'all') return true
  if (mode === 'none') return false
  return token.jlpt === null || RANK[token.jlpt] >= RANK[level]
}
