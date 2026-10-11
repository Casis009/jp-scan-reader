import type { GenerateContentResponse, ThinkingLevel as SdkThinkingLevel } from '@google/genai'
import { JSONParser } from '@streamparser/json'
import type { Settings } from './db'
import { effectiveThinkingLevel } from './models'
import { buildUserMessage, SYSTEM_INSTRUCTION } from '../prompts/analysis'
import {
  layoutSchema,
  normalizeAnalysis,
  normalizeSentence,
  RESPONSE_SCHEMA,
  warnSentenceInconsistencies,
  wireAnalysisSchema,
  wireSentenceSchema,
  type Analysis,
  type Layout,
  type Sentence,
} from '../prompts/schema'

const MAX_OUTPUT_TOKENS = 65536
const RETRIES = 2
const BACKOFF_MS = 4000 // 4초 → 8초

/** 문장을 받기 전이면 재시도하는 HTTP 상태: 429 한도 초과, 503 서버 혼잡 */
const RETRYABLE: Record<number, RetryReason> = { 429: 'quota', 503: 'overloaded' }
export type RetryReason = 'quota' | 'overloaded'

const MESSAGES = {
  quota: '무료 한도 초과, 잠시 후 다시 시도해 주세요.',
  quotaMidStream: '분석 도중 무료 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.',
  overloaded: 'Google 서버가 혼잡합니다. 잠시 후 다시 시도하거나, 다른 모델로 분석해 보세요.',
}

export type AnalysisErrorKind = 'no-key' | 'quota' | 'overloaded' | 'max-tokens' | 'blocked' | 'invalid' | 'api' | 'aborted'

export class AnalysisError extends Error {
  readonly kind: AnalysisErrorKind
  /** 모델이 보낸 원문 응답(형식 오류·잘림일 때) */
  readonly raw?: string
  /** API가 돌려준 원시 오류 메시지("자세히 보기"용) */
  readonly detail?: string

  constructor(kind: AnalysisErrorKind, message: string, raw?: string, detail?: string) {
    super(message)
    this.kind = kind
    this.raw = raw
    this.detail = detail
  }
}

export type Progress =
  | { type: 'request' }
  | { type: 'sentence'; done: number }
  | { type: 'retry-wait'; reason: RetryReason; retry: number; waitMs: number }
  | { type: 'format-retry' }

export interface Stats {
  seconds: number
  /** 첫 문장이 화면에 나오기까지 걸린 시간 */
  firstSentenceSeconds: number | null
  promptTokens?: number
  outputTokens?: number
  thoughtsTokens?: number
  totalTokens?: number
}

export interface StreamHandlers {
  onProgress?: (p: Progress) => void
  onLayout?: (layout: Layout) => void
  onPageNote?: (note: string | null) => void
  /** 문장 하나가 완성·검증될 때마다 */
  onSentence?: (s: Sentence) => void
  /** 형식 오류로 처음부터 다시 받을 때. 지금까지 받은 문장을 지운다. */
  onReset?: () => void
}

export interface AnalyzeResult {
  analysis: Analysis
  raw: string
  stats: Stats
}

/** 스트림 한 조각에서 쓰는 정보만 뽑은 것 */
export interface StreamChunk {
  text?: string
  finishReason?: string
  blockReason?: string
  usage?: GenerateContentResponse['usageMetadata']
}

type OpenStream = () => Promise<AsyncIterable<StreamChunk>>

/** 테스트에서 가짜로 바꿀 수 있는 최소한의 클라이언트 모양 */
export interface StreamClient {
  models: { generateContentStream: (params: never) => Promise<AsyncIterable<GenerateContentResponse>> }
}

interface AnalyzeOptions {
  image: Blob
  settings: Settings
  signal?: AbortSignal
  handlers?: StreamHandlers
  client?: StreamClient
  backoffMs?: number
}

/**
 * 페이지 이미지를 Gemini 스트리밍으로 분석한다.
 * - 문장이 하나 완성될 때마다 zod로 검증해 handlers.onSentence로 넘긴다.
 * - 429·503: 문장을 하나도 받기 전이면 지수 백오프로 최대 2회 재시도, 그래도 실패하면 quota·overloaded 오류.
 *   받은 뒤면 재시도하지 않는다.
 * - finishReason MAX_TOKENS: 재시도 없이 max-tokens 오류(이미 받은 문장은 그대로 둔다)
 * - 스트림이 끝나면 전체 응답을 다시 검증하고, 실패하면 1회 처음부터 다시 받는다.
 */
export async function analyzePage({ image, settings, signal, handlers = {}, client, backoffMs = BACKOFF_MS }: AnalyzeOptions): Promise<AnalyzeResult> {
  if (!settings.apiKey && !client) throw new AnalysisError('no-key', 'API 키가 없습니다. 설정에서 키를 입력하거나 데모 모드를 켜 주세요.')

  const ai = client ?? new (await import('@google/genai')).GoogleGenAI({ apiKey: settings.apiKey })
  const data = await blobToBase64(image)
  const thinkingLevel = effectiveThinkingLevel(settings.model, settings.thinkingLevel)
  const params = {
    model: settings.model,
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: image.type || 'image/jpeg', data } }, { text: buildUserMessage(settings.level) }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: thinkingLevel as SdkThinkingLevel },
      abortSignal: signal,
    },
  }

  const open: OpenStream = async () => fromSdkStream(await ai.models.generateContentStream(params as never))
  const result = await runStream(open, handlers, signal, backoffMs)
  logStats(`${settings.model} (생각 ${thinkingLevel})`, result.stats)
  return result
}

/** 데모 모드: fixture JSON을 조각내 실제와 같은 파서·검증 경로로 흘려보낸다. */
export async function analyzeDemo(fixture: unknown, { signal, handlers = {}, chunkSize = 160, chunkDelayMs = 40 } = {} as {
  signal?: AbortSignal
  handlers?: StreamHandlers
  chunkSize?: number
  chunkDelayMs?: number
}): Promise<AnalyzeResult> {
  const raw = JSON.stringify(fixture)
  const open: OpenStream = async () =>
    (async function* () {
      await sleep(chunkDelayMs * 10, signal) // 생각하는 시간 흉내
      for (let i = 0; i < raw.length; i += chunkSize) {
        await sleep(chunkDelayMs, signal)
        yield { text: raw.slice(i, i + chunkSize) }
      }
      yield { finishReason: 'STOP' }
    })()
  const result = await runStream(open, handlers, signal, 0)
  logStats('데모', result.stats)
  return result
}

async function runStream(open: OpenStream, h: StreamHandlers, signal: AbortSignal | undefined, backoffMs: number): Promise<AnalyzeResult> {
  const startedAt = performance.now()
  let firstSentenceAt: number | null = null
  const handlers: StreamHandlers = {
    ...h,
    onSentence: (s) => {
      firstSentenceAt ??= performance.now()
      h.onSentence?.(s)
    },
  }

  let lastRaw = ''
  let lastProblem = ''
  for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {
    if (formatAttempt > 0) {
      h.onProgress?.({ type: 'format-retry' })
      h.onReset?.()
      firstSentenceAt = null
    } else {
      h.onProgress?.({ type: 'request' })
    }

    const { raw, usage } = await withRetry(() => consumeOnce(open, handlers, signal), signal, backoffMs, h.onProgress)
    const parsed = parseFull(raw)
    if (parsed.ok) {
      const seconds = (performance.now() - startedAt) / 1000
      const stats: Stats = {
        seconds: round1(seconds),
        firstSentenceSeconds: firstSentenceAt === null ? null : round1((firstSentenceAt - startedAt) / 1000),
        promptTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        thoughtsTokens: usage?.thoughtsTokenCount,
        totalTokens: usage?.totalTokenCount,
      }
      return { analysis: parsed.analysis, raw, stats }
    }
    lastRaw = raw
    lastProblem = parsed.problem
    console.warn(`[analysis] 전체 응답 검증 실패(${formatAttempt + 1}/2): ${parsed.problem}`)
  }
  throw new AnalysisError('invalid', `응답 형식이 올바르지 않습니다: ${lastProblem}`, lastRaw)
}

/** 스트림을 한 번 끝까지 읽는다. 429·503은 받은 문장이 없을 때만 RetryableHit으로 알려 재시도하게 한다. */
async function consumeOnce(open: OpenStream, h: StreamHandlers, signal: AbortSignal | undefined) {
  const parser = new JSONParser({ paths: ['$.layout', '$.pageNote', '$.sentences.*'], keepStack: false })
  let emitted = 0
  let parserFailed = false
  parser.onError = () => {
    parserFailed = true // 전체 검증에서 다시 판단한다
  }
  parser.onValue = ({ value, key }) => {
    if (key === 'layout') {
      const r = layoutSchema.safeParse(value)
      if (r.success) h.onLayout?.(r.data)
    } else if (key === 'pageNote') {
      if (typeof value === 'string' || value === null) h.onPageNote?.(value)
    } else if (typeof key === 'number') {
      const r = wireSentenceSchema.safeParse(value)
      if (!r.success) {
        console.warn(`[analysis] ${key + 1}번째 문장 검증 실패, 표시하지 않음: ${r.error.issues[0]?.message}`)
        return
      }
      const s = normalizeSentence(r.data)
      warnSentenceInconsistencies(s)
      emitted++
      h.onSentence?.(s)
      h.onProgress?.({ type: 'sentence', done: emitted })
    }
  }

  let raw = ''
  let finish: string | undefined
  let usage: StreamChunk['usage']
  try {
    const stream = await open()
    for await (const c of stream) {
      if (c.blockReason) throw new AnalysisError('blocked', `요청이 차단되었습니다 (${c.blockReason}).`)
      if (c.text) {
        raw += c.text
        if (!parserFailed) parser.write(c.text)
      }
      if (c.finishReason) finish = c.finishReason
      if (c.usage) usage = c.usage
    }
  } catch (e) {
    throw toAnalysisError(e, signal, emitted)
  }
  if (signal?.aborted) throw new AnalysisError('aborted', '분석을 취소했습니다.')
  if (finish === 'MAX_TOKENS') {
    throw new AnalysisError('max-tokens', '응답이 출력 한도를 넘어 잘렸습니다. 페이지를 나눠 촬영해 주세요.', raw)
  }
  if (finish && finish !== 'STOP') throw new AnalysisError('blocked', `응답이 중단되었습니다 (${finish}).`, raw)
  return { raw, usage }
}

/** 문장을 받기 전에 난 429·503. 재시도 대상이다. */
class RetryableHit extends Error {
  readonly reason: RetryReason
  readonly detail: string

  constructor(reason: RetryReason, detail: string) {
    super(detail)
    this.reason = reason
    this.detail = detail
  }
}

function toAnalysisError(e: unknown, signal: AbortSignal | undefined, emitted: number): Error {
  if (e instanceof AnalysisError) return e
  if (signal?.aborted) return new AnalysisError('aborted', '분석을 취소했습니다.')
  const status = (e as { status?: number }).status
  const detail = `${status ?? ''} ${e instanceof Error ? e.message : String(e)}`.trim()
  console.error('[analysis] API 오류', e)
  const reason = status === undefined ? undefined : RETRYABLE[status]
  if (reason === 'quota') return emitted === 0 ? new RetryableHit(reason, detail) : new AnalysisError('quota', MESSAGES.quotaMidStream, undefined, detail)
  if (reason === 'overloaded') return emitted === 0 ? new RetryableHit(reason, detail) : new AnalysisError('overloaded', MESSAGES.overloaded, undefined, detail)
  return new AnalysisError('api', `API 오류${status ? ` (${status})` : ''}: ${e instanceof Error ? e.message : String(e)}`, undefined, detail)
}

async function withRetry<T>(run: () => Promise<T>, signal: AbortSignal | undefined, backoffMs: number, onProgress: StreamHandlers['onProgress']): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await run()
    } catch (e) {
      if (!(e instanceof RetryableHit)) throw e
      if (retry >= RETRIES) throw new AnalysisError(e.reason, MESSAGES[e.reason], undefined, e.detail)
      const waitMs = backoffMs * 2 ** retry
      onProgress?.({ type: 'retry-wait', reason: e.reason, retry: retry + 1, waitMs })
      await sleep(waitMs, signal)
    }
  }
}

/** SDK 응답 조각에서 생각(thought) 부분을 뺀 본문 텍스트와 종료 정보를 꺼낸다. */
async function* fromSdkStream(stream: AsyncIterable<GenerateContentResponse>): AsyncIterable<StreamChunk> {
  for await (const r of stream) {
    const candidate = r.candidates?.[0]
    const text = candidate?.content?.parts
      ?.filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('')
    yield {
      text: text || undefined,
      finishReason: candidate?.finishReason,
      blockReason: r.promptFeedback?.blockReason,
      usage: r.usageMetadata,
    }
  }
}

function parseFull(raw: string): { ok: true; analysis: Analysis } | { ok: false; problem: string } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    return { ok: false, problem: `JSON 파싱 실패 (${e instanceof Error ? e.message : String(e)})` }
  }
  const result = wireAnalysisSchema.safeParse(json)
  if (result.success) return { ok: true, analysis: normalizeAnalysis(result.data) }
  const issue = result.error.issues[0]
  return { ok: false, problem: `${issue.path.join('.') || '(최상위)'}: ${issue.message}` }
}

function logStats(label: string, s: Stats) {
  console.info(
    `[analysis] ${label}: ${s.seconds}초 (첫 문장 ${s.firstSentenceSeconds ?? '-'}초) · 입력 ${s.promptTokens ?? '-'} · 출력 ${s.outputTokens ?? '-'} · 생각 ${s.thoughtsTokens ?? '-'} · 합계 ${s.totalTokens ?? '-'} 토큰`,
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AnalysisError('aborted', '분석을 취소했습니다.'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new AnalysisError('aborted', '분석을 취소했습니다.'))
    })
  })
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
