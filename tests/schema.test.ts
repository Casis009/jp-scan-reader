import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Schema } from '@google/genai'
import novel from './fixtures/novel-vertical.json'
import jlpt from './fixtures/jlpt-horizontal.json'
import {
  analysisSchema,
  findInconsistencies,
  RESPONSE_SCHEMA,
  warnInconsistencies,
} from '../src/prompts/schema'

const fixtures = { novel, jlpt }

describe('fixtures', () => {
  for (const [name, data] of Object.entries(fixtures)) {
    it(`${name}: zod 검증 통과`, () => {
      expect(analysisSchema.safeParse(data).success).toBe(true)
    })
    it(`${name}: text·surface·ruby 연결 불일치 없음`, () => {
      expect(findInconsistencies(analysisSchema.parse(data))).toEqual([])
    })
  }

  it('엣지 케이스가 들어 있다', () => {
    const all = [...novel.sentences, ...jlpt.sentences]
    const tokens = all.flatMap((s) => s.tokens)
    expect(all.filter((s) => s.text.includes('〓'))).toHaveLength(1)
    expect(tokens.some((t) => t.surface === '。' && t.lemma === null)).toBe(true)
    expect(tokens.some((t) => t.ruby.some((r) => r.base === '今日' && r.rt === 'きょう'))).toBe(true)
    expect(tokens.find((t) => t.surface === '取り扱い')?.ruby.map((r) => r.base)).toEqual(['取', 'り', '扱', 'い'])
    expect(all.some((s) => s.kind === 'choice' && s.translation === null && s.grammar.length === 0)).toBe(true)
  })
})

describe('불일치는 오류가 아니라 경고', () => {
  const broken = structuredClone(novel)
  broken.sentences[1].tokens[0].surface = '明日' // text와 어긋나게
  broken.sentences[1].tokens[2].ruby = [{ base: 'X', rt: '' }] // ruby 연결이 surface와 어긋나게

  it('zod는 그대로 통과한다', () => {
    expect(analysisSchema.safeParse(broken).success).toBe(true)
  })

  it('console.warn만 남긴다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnInconsistencies(analysisSchema.parse(broken))
    // text≠tokens, 明日≠今日(ruby), 朝≠X(ruby)
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })
})

describe('responseSchema와 zod 스키마의 필드 일치', () => {
  // 두 스키마를 같은 모양의 "필드 트리"로 바꿔 비교한다.
  type Tree = string | { [key: string]: Tree } | Tree[]

  function fromGemini(s: Schema): Tree {
    if (s.type === 'OBJECT') {
      expect(s.required).toEqual(Object.keys(s.properties!))
      return Object.fromEntries(Object.entries(s.properties!).map(([k, v]) => [k, fromGemini(v)]))
    }
    if (s.type === 'ARRAY') return [fromGemini(s.items!)]
    return `${s.type}${s.nullable ? '?' : ''}`
  }

  function fromZod(s: z.ZodType): Tree {
    if (s instanceof z.ZodNullable) return `${fromZod(s.unwrap() as z.ZodType)}?`
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
    expect(fromGemini(RESPONSE_SCHEMA)).toEqual(fromZod(analysisSchema))
  })
})
