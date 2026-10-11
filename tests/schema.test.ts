import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Schema } from '@google/genai'
import novel from './fixtures/novel-vertical.json'
import jlpt from './fixtures/jlpt-horizontal.json'
import {
  findInconsistencies,
  parseAnalysis,
  RESPONSE_SCHEMA,
  warnInconsistencies,
  wireAnalysisSchema,
  type WireAnalysis,
} from '../src/prompts/schema'

const fixtures = { novel, jlpt }
const clone = (x: unknown) => structuredClone(x) as WireAnalysis

describe('fixtures', () => {
  for (const [name, data] of Object.entries(fixtures)) {
    it(`${name}: zod 검증 통과`, () => {
      expect(wireAnalysisSchema.safeParse(data).success).toBe(true)
    })
    it(`${name}: text·surface·ruby 연결 불일치 없음`, () => {
      expect(findInconsistencies(parseAnalysis(data))).toEqual([])
    })
  }

  it('엣지 케이스가 들어 있다', () => {
    const all = [...parseAnalysis(novel).sentences, ...parseAnalysis(jlpt).sentences]
    const tokens = all.flatMap((s) => s.tokens)
    expect(all.filter((s) => s.text.includes('〓'))).toHaveLength(1)
    expect(tokens.some((t) => t.surface === '。' && t.lemma === null)).toBe(true)
    expect(tokens.some((t) => t.ruby.some((r) => r.base === '今日' && r.rt === 'きょう'))).toBe(true)
    expect(tokens.find((t) => t.surface === '取り扱い')?.ruby.map((r) => r.base)).toEqual(['取', 'り', '扱', 'い'])
    expect(all.some((s) => s.kind === 'choice' && s.translation === null && s.grammar.length === 0)).toBe(true)
  })

  it('압축 형식으로 저장돼 있다(생략 규칙을 지킨다)', () => {
    const wire = [...clone(novel).sentences, ...clone(jlpt).sentences].flatMap((s) => s.tokens)
    expect(wire.find((t) => t.surface === '。')).toEqual({ surface: '。' })
    expect(wire.find((t) => t.surface === 'は')).not.toHaveProperty('ruby')
    expect(wire.find((t) => t.surface === '今日')).not.toHaveProperty('lemma')
    expect(wire.every((t) => t.rubyInSource !== false)).toBe(true)
    expect(wire.every((t) => t.conjugation !== null && t.jlpt !== null)).toBe(true)
  })
})

describe('압축 형식 → 내부 타입 기본값', () => {
  const parsed = parseAnalysis({
    layout: { direction: 'horizontal', confidence: 1 },
    pageNote: null,
    sentences: [
      {
        id: 1,
        kind: 'body',
        text: '今日はコーヒーを飲んだ。',
        translation: '오늘은 커피를 마셨다.',
        incomplete: false,
        tokens: [
          { surface: '今日', ruby: [{ base: '今日', rt: 'きょう' }], pos: '명사', meaning: '오늘', jlpt: 'N5' },
          { surface: 'は', pos: '조사', meaning: '~은/는' },
          { surface: 'コーヒー', pos: '명사', meaning: '커피', rubyInSource: true },
          { surface: 'を', pos: '조사', meaning: '~을/를' },
          { surface: '飲んだ', ruby: [{ base: '飲', rt: 'の' }, { base: 'んだ', rt: '' }], lemma: '飲む', lemmaReading: 'のむ', pos: '동사(5단)', conjugation: '과거', meaning: '마시다' },
          { surface: '。' },
        ],
        grammar: [],
        uncertain: [],
        uncertainNote: null,
      },
    ],
  })
  const [kyou, wa, coffee, , nonda, maru] = parsed.sentences[0].tokens

  it('lemma 생략 → surface, 읽기는 ruby에서', () => {
    expect([kyou.lemma, kyou.lemmaReading]).toEqual(['今日', 'きょう'])
    expect([wa.lemma, wa.lemmaReading]).toEqual(['は', 'は'])
    expect([coffee.lemma, coffee.lemmaReading]).toEqual(['コーヒー', 'コーヒー'])
  })
  it('ruby 생략 → surface 한 조각, 빈 rt', () => {
    expect(wa.ruby).toEqual([{ base: 'は', rt: '' }])
  })
  it('나머지 기본값', () => {
    expect([wa.jlpt, wa.conjugation, wa.rubyInSource, coffee.rubyInSource]).toEqual([null, null, false, true])
    expect([nonda.lemma, nonda.lemmaReading, nonda.conjugation]).toEqual(['飲む', 'のむ', '과거'])
  })
  it('surface만 있는 토큰은 문장부호', () => {
    expect(maru).toEqual({ surface: '。', ruby: [{ base: '。', rt: '' }], lemma: null, lemmaReading: null, pos: null, conjugation: null, meaning: null, jlpt: null, rubyInSource: false })
  })
  it('예전 전체 형식(null 채움)도 그대로 읽는다', () => {
    const old = { surface: '。', ruby: [{ base: '。', rt: '' }], lemma: null, lemmaReading: null, pos: null, conjugation: null, meaning: null, jlpt: null, rubyInSource: false }
    const p = parseAnalysis({ ...clone(novel), sentences: [{ ...clone(novel).sentences[1], text: '。', tokens: [old] }] })
    expect(p.sentences[0].tokens[0]).toEqual(maru)
  })
})

describe('불일치는 오류가 아니라 경고', () => {
  const broken = clone(novel)
  broken.sentences[1].tokens[0].surface = '明日' // text와 어긋나게
  broken.sentences[1].tokens[2].ruby = [{ base: 'X', rt: '' }] // ruby 연결이 surface와 어긋나게

  it('zod는 그대로 통과한다', () => {
    expect(wireAnalysisSchema.safeParse(broken).success).toBe(true)
  })

  it('console.warn만 남긴다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnInconsistencies(parseAnalysis(broken))
    // text≠tokens, 明日≠今日(ruby), 朝≠X(ruby)
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })
})

describe('responseSchema와 zod 스키마의 필드 일치', () => {
  // 두 스키마를 같은 모양의 "필드 트리"로 바꿔 비교한다. 생략 가능·null 가능은 모두 '?'로 표시한다.
  type Tree = string | { [key: string]: Tree } | Tree[]

  function fromGemini(s: Schema): Tree {
    if (s.type === 'OBJECT') {
      return Object.fromEntries(
        Object.entries(s.properties!).map(([k, v]) => {
          const t = fromGemini(v)
          return [k, s.required!.includes(k) || typeof t !== 'string' || t.endsWith('?') ? t : `${t}?`]
        }),
      )
    }
    if (s.type === 'ARRAY') return [fromGemini(s.items!)]
    return `${s.type}${s.nullable ? '?' : ''}`
  }

  function fromZod(s: z.ZodType): Tree {
    if (s instanceof z.ZodNullable || s instanceof z.ZodOptional) {
      const inner = fromZod(s.unwrap() as z.ZodType)
      return typeof inner === 'string' && !inner.endsWith('?') ? `${inner}?` : inner
    }
    if (s instanceof z.ZodObject) {
      return Object.fromEntries(Object.entries(s.shape).map(([k, v]) => [k, fromZod(v as z.ZodType)]))
    }
    if (s instanceof z.ZodArray) return [fromZod(s.element as z.ZodType)]
    if (s instanceof z.ZodEnum || s instanceof z.ZodString) return 'STRING'
    if (s instanceof z.ZodBoolean) return 'BOOLEAN'
    if (s instanceof z.ZodNumber) return s.format === 'safeint' ? 'INTEGER' : 'NUMBER'
    throw new Error(`처리하지 않은 zod 타입: ${s.constructor.name}`)
  }

  it('같다', () => {
    const tree = fromZod(wireAnalysisSchema) as { sentences: [{ tokens: [Record<string, string | Tree[]>] }] }
    // ruby는 배열 자체가 생략 가능 — 배열 트리에는 '?'를 붙일 수 없어 따로 확인한다.
    const required = (RESPONSE_SCHEMA.properties!.sentences.items!.properties!.tokens.items!.required ?? []) as string[]
    expect(required).toEqual(['surface'])
    expect(fromGemini(RESPONSE_SCHEMA)).toEqual(tree)
  })
})
