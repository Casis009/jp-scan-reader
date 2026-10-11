import type { Schema, Type } from '@google/genai'
import { z } from 'zod'
import { isKana } from '../lib/kana'

// docs/analysis-prompt.md "출력 형식"의 표현들.
// - wire*Schema: 모델 응답(압축 형식) 검증용 zod 스키마. 깨지면 1회 재시도한다.
// - RESPONSE_SCHEMA: Gemini에 넘기는 responseSchema. 생략 가능한 필드는 required에서 뺀다.
// - Analysis/Sentence/Token: 앱 내부 타입. normalize*()가 생략된 필드의 기본값을 채운다.
// 필드를 바꾸면 zod와 RESPONSE_SCHEMA를 함께 고친다(schema.test.ts가 필드 목록 일치를 확인).
//
// text = tokens[].surface 연결, surface = ruby[].base 연결, 읽기가 가나인지는 여기서 검사하지 않는다.
// 어긋나도 재시도하지 않고 findInconsistencies()로 경고만 남긴다.
// 문장 읽기(reading)는 모델에게 받지 않고 화면에서 tokens로 계산한다(lib/display.ts).

const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const DIRECTIONS = ['vertical', 'horizontal', 'mixed'] as const
const KINDS = ['body', 'heading', 'question', 'choice'] as const

type Jlpt = (typeof JLPT)[number]

// ---- 모델 응답(압축 형식) ----
// 생략 가능한 토큰 필드는 nullish로 받는다. 예전 형식(모든 필드 + null)도 그대로 통과한다.

const rubyPartSchema = z.object({
  base: z.string(),
  rt: z.string(),
})

const wireTokenSchema = z.object({
  surface: z.string(),
  ruby: z.array(rubyPartSchema).nullish(),
  lemma: z.string().nullish(),
  lemmaReading: z.string().nullish(),
  pos: z.string().nullish(),
  conjugation: z.string().nullish(),
  meaning: z.string().nullish(),
  jlpt: z.enum(JLPT).nullish(),
  rubyInSource: z.boolean().nullish(),
})

const grammarSchema = z.object({
  pattern: z.string(),
  level: z.enum(JLPT).nullable(),
  explanation: z.string(),
  usage: z.string(),
})

const uncertainSchema = z.object({
  index: z.number().int(),
  candidates: z.array(z.string()),
})

export const wireSentenceSchema = z.object({
  id: z.number().int(),
  kind: z.enum(KINDS),
  text: z.string(),
  translation: z.string().nullable(),
  incomplete: z.boolean(),
  tokens: z.array(wireTokenSchema),
  grammar: z.array(grammarSchema),
  uncertain: z.array(uncertainSchema),
  uncertainNote: z.string().nullable(),
})

export const layoutSchema = z.object({
  direction: z.enum(DIRECTIONS),
  confidence: z.number(),
})

export const wireAnalysisSchema = z.object({
  layout: layoutSchema,
  pageNote: z.string().nullable(),
  sentences: z.array(wireSentenceSchema),
})

export type WireAnalysis = z.infer<typeof wireAnalysisSchema>
export type WireSentence = z.infer<typeof wireSentenceSchema>
type WireToken = z.infer<typeof wireTokenSchema>

// ---- 앱 내부 타입 ----

export type Layout = z.infer<typeof layoutSchema>
export type Grammar = z.infer<typeof grammarSchema>
export type RubyPart = z.infer<typeof rubyPartSchema>

export interface Token {
  surface: string
  ruby: RubyPart[]
  /** 문장부호·기호·〓면 null */
  lemma: string | null
  lemmaReading: string | null
  pos: string | null
  conjugation: string | null
  meaning: string | null
  jlpt: Jlpt | null
  rubyInSource: boolean
}

export interface Sentence extends Omit<WireSentence, 'tokens'> {
  tokens: Token[]
}

export interface Analysis {
  layout: Layout
  pageNote: string | null
  sentences: Sentence[]
}

/** 단어 정보(pos·meaning·lemma)가 하나도 없으면 문장부호·기호 토큰으로 본다. */
function normalizeToken(t: WireToken): Token {
  const ruby = t.ruby?.length ? t.ruby : [{ base: t.surface, rt: '' }]
  const isWord = t.pos != null || t.meaning != null || t.lemma != null
  if (!isWord) {
    return { surface: t.surface, ruby, lemma: null, lemmaReading: null, pos: null, conjugation: null, meaning: null, jlpt: null, rubyInSource: false }
  }
  // lemma가 생략됐으면 surface와 같다는 뜻이다. 그때 읽기는 surface의 ruby에서 만든다.
  // 만든 읽기가 가나가 아니면(잘못된 rt 등) 모델이 보낸 값이 아니므로 경고 없이 비워 둔다.
  const sameAsSurface = t.lemma == null || t.lemma === t.surface
  const derived = sameAsSurface ? ruby.map((r) => r.rt || r.base).join('') : null
  return {
    surface: t.surface,
    ruby,
    lemma: t.lemma ?? t.surface,
    lemmaReading: t.lemmaReading ?? (derived !== null && isKana(derived) ? derived : null),
    pos: t.pos ?? null,
    conjugation: t.conjugation ?? null,
    meaning: t.meaning ?? null,
    jlpt: t.jlpt ?? null,
    rubyInSource: t.rubyInSource ?? false,
  }
}

export function normalizeSentence(s: WireSentence): Sentence {
  return { ...s, tokens: s.tokens.map(normalizeToken) }
}

export function normalizeAnalysis(a: WireAnalysis): Analysis {
  return { ...a, sentences: a.sentences.map(normalizeSentence) }
}

/** 검증 + 기본값 채우기. 형식이 틀리면 ZodError를 던진다. */
export function parseAnalysis(json: unknown): Analysis {
  return normalizeAnalysis(wireAnalysisSchema.parse(json))
}

// ---- Gemini responseSchema ----

// SDK 본체를 메인 번들에 넣지 않으려고 Type enum은 타입으로만 쓰고 값은 문자열로 적는다.
const T = { STRING: 'STRING', NUMBER: 'NUMBER', INTEGER: 'INTEGER', BOOLEAN: 'BOOLEAN', ARRAY: 'ARRAY', OBJECT: 'OBJECT' } as Record<string, Type>

const str: Schema = { type: T.STRING }
const nullableStr: Schema = { type: T.STRING, nullable: true }
const bool: Schema = { type: T.BOOLEAN }
const int: Schema = { type: T.INTEGER }
const jlptSchema: Schema = { type: T.STRING, enum: [...JLPT] }

/** properties 순서대로 propertyOrdering을 채운 object 스키마. optional에 적은 키는 required에서 뺀다. */
function object(properties: Record<string, Schema>, optional: string[] = []): Schema {
  const keys = Object.keys(properties)
  return { type: T.OBJECT, properties, required: keys.filter((k) => !optional.includes(k)), propertyOrdering: keys }
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
        object(
          {
            surface: str,
            ruby: array(object({ base: str, rt: str })),
            lemma: str,
            lemmaReading: str,
            pos: str,
            conjugation: str,
            meaning: str,
            jlpt: jlptSchema,
            rubyInSource: bool,
          },
          ['ruby', 'lemma', 'lemmaReading', 'pos', 'conjugation', 'meaning', 'jlpt', 'rubyInSource'],
        ),
      ),
      grammar: array(object({ pattern: str, level: { ...jlptSchema, nullable: true }, explanation: str, usage: str }), 3),
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
  return analysis.sentences.flatMap(findSentenceInconsistencies)
}

export function findSentenceInconsistencies(s: Sentence): Inconsistency[] {
  const found: Inconsistency[] = []
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
  return found
}

export function warnSentenceInconsistencies(s: Sentence) {
  for (const i of findSentenceInconsistencies(s)) console.warn(`[analysis] 문장 ${i.sentenceId}: ${i.message}`)
}

export function warnInconsistencies(analysis: Analysis) {
  analysis.sentences.forEach(warnSentenceInconsistencies)
}
