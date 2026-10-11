import type { Schema, Type } from '@google/genai'
import { z } from 'zod'
import { isKana } from '../lib/kana'

// docs/analysis-prompt.md "출력 형식"의 두 가지 표현.
// - analysisSchema: 응답 검증용 zod 스키마. 깨지면 1회 재시도한다.
// - RESPONSE_SCHEMA: Gemini에 넘기는 responseSchema.
// 필드를 바꾸면 둘 다 고친다(schema.test.ts가 필드 목록 일치를 확인).
//
// text = tokens[].surface 연결, surface = ruby[].base 연결, 읽기가 가나인지는 여기서 검사하지 않는다.
// 어긋나도 재시도하지 않고 findInconsistencies()로 경고만 남긴다.
// 문장 읽기(reading)는 모델에게 받지 않고 화면에서 tokens로 계산한다(lib/display.ts).

const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const DIRECTIONS = ['vertical', 'horizontal', 'mixed'] as const
const KINDS = ['body', 'heading', 'question', 'choice'] as const

const jlpt = z.enum(JLPT).nullable()

const rubyPartSchema = z.object({
  base: z.string(),
  rt: z.string(),
})

const tokenSchema = z.object({
  surface: z.string(),
  ruby: z.array(rubyPartSchema),
  lemma: z.string().nullable(),
  lemmaReading: z.string().nullable(),
  pos: z.string().nullable(),
  conjugation: z.string().nullable(),
  meaning: z.string().nullable(),
  jlpt,
  rubyInSource: z.boolean(),
})

const grammarSchema = z.object({
  pattern: z.string(),
  level: jlpt,
  explanation: z.string(),
  usage: z.string(),
})

const uncertainSchema = z.object({
  index: z.number().int(),
  candidates: z.array(z.string()),
})

const sentenceSchema = z.object({
  id: z.number().int(),
  kind: z.enum(KINDS),
  text: z.string(),
  translation: z.string().nullable(),
  incomplete: z.boolean(),
  tokens: z.array(tokenSchema),
  grammar: z.array(grammarSchema),
  uncertain: z.array(uncertainSchema),
  uncertainNote: z.string().nullable(),
})

export const analysisSchema = z.object({
  layout: z.object({
    direction: z.enum(DIRECTIONS),
    confidence: z.number(),
  }),
  pageNote: z.string().nullable(),
  sentences: z.array(sentenceSchema),
})

export type Analysis = z.infer<typeof analysisSchema>
export type Sentence = z.infer<typeof sentenceSchema>
export type Token = z.infer<typeof tokenSchema>
export type Grammar = z.infer<typeof grammarSchema>

// ---- Gemini responseSchema ----

// SDK 본체를 메인 번들에 넣지 않으려고 Type enum은 타입으로만 쓰고 값은 문자열로 적는다.
const T = { STRING: 'STRING', NUMBER: 'NUMBER', INTEGER: 'INTEGER', BOOLEAN: 'BOOLEAN', ARRAY: 'ARRAY', OBJECT: 'OBJECT' } as Record<string, Type>

const str: Schema = { type: T.STRING }
const nullableStr: Schema = { type: T.STRING, nullable: true }
const bool: Schema = { type: T.BOOLEAN }
const int: Schema = { type: T.INTEGER }
const jlptSchema: Schema = { type: T.STRING, enum: [...JLPT], nullable: true }

/** properties 순서대로 required·propertyOrdering을 채운 object 스키마. */
function object(properties: Record<string, Schema>): Schema {
  const keys = Object.keys(properties)
  return { type: T.OBJECT, properties, required: keys, propertyOrdering: keys }
}

function array(items: Schema, maxItems?: number): Schema {
  return { type: T.ARRAY, items, ...(maxItems ? { maxItems: String(maxItems) } : {}) }
}

export const RESPONSE_SCHEMA: Schema = object({
  layout: object({
    direction: { type: T.STRING, enum: [...DIRECTIONS] },
    confidence: { type: T.NUMBER, minimum: 0, maximum: 1 },
  }),
  pageNote: nullableStr,
  sentences: array(
    object({
      id: int,
      kind: { type: T.STRING, enum: [...KINDS] },
      text: str,
      translation: nullableStr,
      incomplete: bool,
      tokens: array(
        object({
          surface: str,
          ruby: array(object({ base: str, rt: str })),
          lemma: nullableStr,
          lemmaReading: nullableStr,
          pos: nullableStr,
          conjugation: nullableStr,
          meaning: nullableStr,
          jlpt: jlptSchema,
          rubyInSource: bool,
        }),
      ),
      grammar: array(object({ pattern: str, level: jlptSchema, explanation: str, usage: str }), 3),
      uncertain: array(object({ index: int, candidates: array(str) })),
      uncertainNote: nullableStr,
    }),
  ),
})

// ---- 표시용 일관성 검사 ----

export interface Inconsistency {
  sentenceId: number
  message: string
}

/** 이어 붙인 값이 맞지 않는 곳을 찾는다. 화면은 항상 tokens 기준으로 그리므로 표시에는 영향이 없다. */
export function findInconsistencies(analysis: Analysis): Inconsistency[] {
  const found: Inconsistency[] = []
  for (const s of analysis.sentences) {
    const joined = s.tokens.map((t) => t.surface).join('')
    if (joined !== s.text) {
      found.push({ sentenceId: s.id, message: `text와 tokens 연결이 다름: "${s.text}" ≠ "${joined}"` })
    }
    for (const t of s.tokens) {
      const bases = t.ruby.map((r) => r.base).join('')
      if (bases !== t.surface) {
        found.push({ sentenceId: s.id, message: `surface와 ruby 연결이 다름: "${t.surface}" ≠ "${bases}"` })
      }
      if (t.lemmaReading !== null && !isKana(t.lemmaReading)) {
        found.push({ sentenceId: s.id, message: `"${t.surface}"의 lemmaReading에 가나 이외 문자: "${t.lemmaReading}"` })
      }
      for (const r of t.ruby) {
        if (!isKana(r.rt)) found.push({ sentenceId: s.id, message: `"${r.base}"의 rt에 가나 이외 문자: "${r.rt}"` })
      }
    }
    const marks = [...s.text].filter((c) => c === '〓').length
    for (const u of s.uncertain) {
      if (u.index < 0 || u.index >= marks) {
        found.push({ sentenceId: s.id, message: `uncertain.index ${u.index}에 해당하는 〓가 없음(〓 ${marks}개)` })
      }
    }
  }
  return found
}

export function warnInconsistencies(analysis: Analysis) {
  for (const i of findInconsistencies(analysis)) console.warn(`[analysis] 문장 ${i.sentenceId}: ${i.message}`)
}
