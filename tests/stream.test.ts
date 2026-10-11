import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateContentResponse } from '@google/genai'
import novel from './fixtures/novel-vertical.json'
import { DEFAULT_SETTINGS } from '../src/lib/db'
import { AnalysisError, analyzeDemo, analyzePage, type Progress, type StreamClient } from '../src/lib/gemini'
import { parseAnalysis, type Sentence } from '../src/prompts/schema'

const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key' }
const image = new Blob(['jpeg'], { type: 'image/jpeg' })
const RAW = JSON.stringify(novel)
const USAGE = { promptTokenCount: 1200, candidatesTokenCount: 3400, thoughtsTokenCount: 500, totalTokenCount: 5100 }

type Step = { text?: string; finishReason?: string; usage?: typeof USAGE }

function chunk({ text, finishReason, usage }: Step) {
  return { candidates: [{ content: { parts: text ? [{ text }] : [] }, finishReason }], usageMetadata: usage } as unknown as GenerateContentResponse
}

/** raw를 n글자씩 잘라 흘려보내는 스트림. onYield는 조각을 내보낸 뒤 호출된다. */
function streamOf(raw: string, { size = 40, finishReason = 'STOP', onYield }: { size?: number; finishReason?: string; onYield?: (i: number) => void } = {}) {
  return (signal?: AbortSignal) =>
    (async function* () {
      let i = 0
      for (let p = 0; p < raw.length; p += size) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
        yield chunk({ text: raw.slice(p, p + size) })
        onYield?.(i++)
      }
      yield chunk({ finishReason, usage: USAGE })
    })()
}

type Script = ((signal?: AbortSignal) => AsyncIterable<GenerateContentResponse>) | { status: number }

/** 호출될 때마다 script를 하나씩 소비하는 가짜 클라이언트 */
function fakeClient(script: Script[]) {
  let calls = 0
  const client: StreamClient = {
    models: {
      generateContentStream: (async (params: { config: { abortSignal?: AbortSignal } }) => {
        const step = script[calls++]
        if (!step) throw new Error('예상보다 많이 호출됨')
        if (typeof step !== 'function') throw Object.assign(new Error(`HTTP ${step.status}`), step)
        return step(params.config.abortSignal)
      }) as never,
    },
  }
  return { client, calls: () => calls }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('스트리밍 분석', () => {
  it('문장이 완성될 때마다 하나씩 넘기고, 끝나면 전체를 다시 검증한다', async () => {
    let chunksSent = 0
    const seenAt: number[] = []
    const { client } = fakeClient([streamOf(RAW, { onYield: (i) => (chunksSent = i + 1) })])
    const sentences: Sentence[] = []
    const result = await analyzePage({
      image,
      settings,
      client,
      handlers: {
        onSentence: (s) => {
          sentences.push(s)
          seenAt.push(chunksSent)
        },
      },
    })
    const expected = parseAnalysis(novel)
    expect(sentences).toEqual(expected.sentences)
    expect(result.analysis).toEqual(expected)
    // 첫 문장은 스트림이 끝나기 훨씬 전에 도착한다
    expect(seenAt[0]).toBeLessThan(chunksSent / 2)
    expect(seenAt).toEqual([...seenAt].sort((a, b) => a - b))
    expect(result.stats).toMatchObject({ promptTokens: 1200, outputTokens: 3400, thoughtsTokens: 500, totalTokens: 5100 })
    expect(result.stats.firstSentenceSeconds).not.toBeNull()
  })

  it('진행 상황: 판독 중 → n번째 문장', async () => {
    const { client } = fakeClient([streamOf(RAW)])
    const progress: Progress[] = []
    await analyzePage({ image, settings, client, handlers: { onProgress: (p) => progress.push(p) } })
    expect(progress[0]).toEqual({ type: 'request' })
    expect(progress.filter((p) => p.type === 'sentence').map((p) => (p as { done: number }).done)).toEqual([1, 2, 3, 4, 5])
  })

  it('429는 문장을 받기 전이면 지수 백오프로 2회까지 재시도한다', async () => {
    const { client, calls } = fakeClient([{ status: 429 }, { status: 429 }, streamOf(RAW)])
    const progress: Progress[] = []
    const result = await analyzePage({ image, settings, client, backoffMs: 1, handlers: { onProgress: (p) => progress.push(p) } })
    expect(calls()).toBe(3)
    expect(progress.filter((p) => p.type === 'retry-wait')).toEqual([
      { type: 'retry-wait', reason: 'quota', retry: 1, waitMs: 1 },
      { type: 'retry-wait', reason: 'quota', retry: 2, waitMs: 2 },
    ])
    expect(result.analysis.sentences).toHaveLength(5)
  })

  it('429가 세 번이면 무료 한도 초과 안내', async () => {
    const { client, calls } = fakeClient([{ status: 429 }, { status: 429 }, { status: 429 }])
    const err = await analyzePage({ image, settings, client, backoffMs: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(AnalysisError)
    expect(err.kind).toBe('quota')
    expect(err.message).toContain('무료 한도 초과')
    expect(calls()).toBe(3)
  })

  it('문장을 받은 뒤의 429는 재시도하지 않는다', async () => {
    const midStream429 = (async function* () {
      yield chunk({ text: RAW.slice(0, RAW.indexOf('"id":3')) }) // 문장 1·2까지 보낸 뒤
      throw Object.assign(new Error('HTTP 429'), { status: 429 })
    })
    const { client, calls } = fakeClient([() => midStream429(), streamOf(RAW)])
    const sentences: Sentence[] = []
    const err = await analyzePage({ image, settings, client, backoffMs: 1, handlers: { onSentence: (s) => sentences.push(s) } }).catch((e) => e)
    expect(sentences.length).toBeGreaterThan(0)
    expect(err.kind).toBe('quota')
    expect(calls()).toBe(1)
  })

  it('503도 문장을 받기 전이면 4초·8초 간격으로 2회까지 재시도한다', async () => {
    const { client, calls } = fakeClient([{ status: 503 }, { status: 503 }, streamOf(RAW)])
    const progress: Progress[] = []
    const result = await analyzePage({ image, settings, client, backoffMs: 1, handlers: { onProgress: (p) => progress.push(p) } })
    expect(calls()).toBe(3)
    expect(progress.filter((p) => p.type === 'retry-wait')).toEqual([
      { type: 'retry-wait', reason: 'overloaded', retry: 1, waitMs: 1 },
      { type: 'retry-wait', reason: 'overloaded', retry: 2, waitMs: 2 },
    ])
    expect(result.analysis.sentences).toHaveLength(5)
  })

  it('기본 백오프는 4초 → 8초', async () => {
    vi.useFakeTimers()
    try {
      const { client, calls } = fakeClient([{ status: 503 }, { status: 503 }, streamOf(RAW)])
      const done = analyzePage({ image, settings, client })
      await vi.advanceTimersByTimeAsync(3999)
      expect(calls()).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls()).toBe(2)
      await vi.advanceTimersByTimeAsync(7999)
      expect(calls()).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls()).toBe(3)
      await done
    } finally {
      vi.useRealTimers()
    }
  })

  it('503이 세 번이면 서버 혼잡 안내, 원시 오류는 detail과 콘솔에', async () => {
    const { client, calls } = fakeClient([{ status: 503 }, { status: 503 }, { status: 503 }])
    const err = await analyzePage({ image, settings, client, backoffMs: 1 }).catch((e) => e)
    expect(err.kind).toBe('overloaded')
    expect(err.message).toBe('Google 서버가 혼잡합니다. 잠시 후 다시 시도하거나, 다른 모델로 분석해 보세요.')
    expect(err.detail).toContain('503')
    expect(err.raw).toBeUndefined()
    expect(console.error).toHaveBeenCalled()
    expect(calls()).toBe(3)
  })

  it('문장을 받은 뒤의 503은 재시도하지 않고 안내만 한다', async () => {
    const midStream503 = async function* () {
      yield chunk({ text: RAW.slice(0, RAW.indexOf('"id":3')) })
      throw Object.assign(new Error('HTTP 503 UNAVAILABLE'), { status: 503 })
    }
    const { client, calls } = fakeClient([() => midStream503(), streamOf(RAW)])
    const sentences: Sentence[] = []
    const err = await analyzePage({ image, settings, client, backoffMs: 1, handlers: { onSentence: (s) => sentences.push(s) } }).catch((e) => e)
    expect(sentences).toHaveLength(2)
    expect(err.kind).toBe('overloaded')
    expect(err.detail).toContain('UNAVAILABLE')
    expect(calls()).toBe(1)
  })

  it('그 밖의 HTTP 오류는 재시도하지 않는다', async () => {
    const { client, calls } = fakeClient([{ status: 500 }, streamOf(RAW)])
    const err = await analyzePage({ image, settings, client, backoffMs: 1 }).catch((e) => e)
    expect(err.kind).toBe('api')
    expect(calls()).toBe(1)
  })

  it('MAX_TOKENS면 재시도 없이 "페이지를 나눠 촬영" 안내, 받은 문장은 남는다', async () => {
    const half = RAW.slice(0, Math.floor(RAW.length * 0.6))
    const { client, calls } = fakeClient([streamOf(half, { finishReason: 'MAX_TOKENS' })])
    const sentences: Sentence[] = []
    const err = await analyzePage({ image, settings, client, handlers: { onSentence: (s) => sentences.push(s) } }).catch((e) => e)
    expect(err.kind).toBe('max-tokens')
    expect(err.message).toContain('페이지를 나눠 촬영해 주세요')
    expect(err.raw).toBe(half)
    expect(sentences.length).toBeGreaterThanOrEqual(2)
    expect(calls()).toBe(1)
  })

  it('취소하면 스트림 도중에 aborted로 끝난다', async () => {
    const ctrl = new AbortController()
    const { client } = fakeClient([streamOf(RAW)])
    const sentences: Sentence[] = []
    const err = await analyzePage({
      image,
      settings,
      client,
      signal: ctrl.signal,
      handlers: {
        onSentence: (s) => {
          sentences.push(s)
          if (sentences.length === 2) ctrl.abort()
        },
      },
    }).catch((e) => e)
    expect(err.kind).toBe('aborted')
    expect(sentences).toHaveLength(2)
  })

  it('전체 검증이 실패하면 처음부터 1회 다시 받는다', async () => {
    const broken = RAW.replace('"direction":"vertical"', '"direction":"diagonal"')
    const { client, calls } = fakeClient([streamOf(broken), streamOf(RAW)])
    const resets = vi.fn()
    const result = await analyzePage({ image, settings, client, handlers: { onReset: resets } })
    expect(calls()).toBe(2)
    expect(resets).toHaveBeenCalledTimes(1)
    expect(result.analysis).toEqual(parseAnalysis(novel))
  })

  it('두 번 다 형식이 깨지면 원문 응답과 함께 오류', async () => {
    const broken = RAW.slice(0, -10)
    const { client, calls } = fakeClient([streamOf(broken), streamOf(broken)])
    const err = await analyzePage({ image, settings, client }).catch((e) => e)
    expect(err.kind).toBe('invalid')
    expect(err.raw).toBe(broken)
    expect(calls()).toBe(2)
  })

  it('형식이 깨진 문장은 건너뛰고 나머지는 표시한다', async () => {
    const parsed = JSON.parse(RAW)
    delete parsed.sentences[1].kind
    const { client } = fakeClient([streamOf(JSON.stringify(parsed)), streamOf(RAW)])
    const first: number[] = []
    let resetDone = false
    await analyzePage({
      image,
      settings,
      client,
      handlers: { onSentence: (s) => !resetDone && first.push(s.id), onReset: () => (resetDone = true) },
    })
    expect(first).toEqual([1, 3, 4, 5])
  })
})

describe('데모 모드', () => {
  it('같은 파서로 문장을 하나씩 흘려보낸다', async () => {
    const sentences: Sentence[] = []
    const result = await analyzeDemo(novel, { chunkDelayMs: 0, handlers: { onSentence: (s) => sentences.push(s) } })
    expect(sentences).toHaveLength(5)
    expect(result.analysis).toEqual(parseAnalysis(novel))
  })
})
