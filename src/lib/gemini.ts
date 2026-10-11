import type { GenerateContentResponse } from '@google/genai'
import type { Settings } from './db'
import { buildUserMessage, SYSTEM_INSTRUCTION } from '../prompts/analysis'
import { analysisSchema, RESPONSE_SCHEMA, warnInconsistencies, type Analysis } from '../prompts/schema'

const MAX_OUTPUT_TOKENS = 65536
const QUOTA_RETRIES = 2
const QUOTA_BACKOFF_MS = 4000 // 4초 → 8초

export type AnalysisErrorKind = 'no-key' | 'quota' | 'max-tokens' | 'blocked' | 'invalid' | 'api' | 'aborted'

export class AnalysisError extends Error {
  readonly kind: AnalysisErrorKind
  /** 형식 오류일 때 모델이 보낸 원문 응답 */
  readonly raw?: string

  constructor(kind: AnalysisErrorKind, message: string, raw?: string) {
    super(message)
    this.kind = kind
    this.raw = raw
  }
}

export type Progress =
  | { type: 'request' }
  | { type: 'quota-wait'; retry: number; waitMs: number }
  | { type: 'format-retry' }

export interface AnalyzeResult {
  analysis: Analysis
  raw: string
}

interface AnalyzeOptions {
  image: Blob
  settings: Settings
  signal?: AbortSignal
  onProgress?: (p: Progress) => void
}

/**
 * 페이지 이미지를 Gemini로 분석한다.
 * - 429: 지수 백오프로 최대 2회 재시도, 그래도 실패하면 quota 오류
 * - finishReason MAX_TOKENS: 재시도 없이 max-tokens 오류
 * - JSON·zod 검증 실패: 1회 다시 요청, 그래도 실패하면 원문 응답과 함께 invalid 오류
 */
export async function analyzePage({ image, settings, signal, onProgress }: AnalyzeOptions): Promise<AnalyzeResult> {
  if (!settings.apiKey) throw new AnalysisError('no-key', 'API 키가 없습니다. 설정에서 키를 입력하거나 데모 모드를 켜 주세요.')

  const { GoogleGenAI, ThinkingLevel } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey: settings.apiKey })
  const data = await blobToBase64(image)

  const request = () =>
    ai.models.generateContent({
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
        thinkingConfig: { thinkingLevel: ThinkingLevel[settings.thinkingLevel] },
        abortSignal: signal,
      },
    })

  let lastRaw = ''
  let lastProblem = ''
  for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {
    if (formatAttempt > 0) onProgress?.({ type: 'format-retry' })
    else onProgress?.({ type: 'request' })

    const response = await withQuotaRetry(request, signal, onProgress)
    const raw = textOf(response)
    const parsed = parse(raw)
    if (parsed.ok) {
      warnInconsistencies(parsed.analysis)
      return { analysis: parsed.analysis, raw }
    }
    lastRaw = raw
    lastProblem = parsed.problem
  }
  throw new AnalysisError('invalid', `응답 형식이 올바르지 않습니다: ${lastProblem}`, lastRaw)
}

async function withQuotaRetry(
  request: () => Promise<GenerateContentResponse>,
  signal: AbortSignal | undefined,
  onProgress: AnalyzeOptions['onProgress'],
): Promise<GenerateContentResponse> {
  for (let retry = 0; ; retry++) {
    try {
      return await request()
    } catch (e) {
      if (signal?.aborted) throw new AnalysisError('aborted', '분석을 취소했습니다.')
      const status = (e as { status?: number }).status
      if (status !== 429) {
        throw new AnalysisError('api', `API 오류${status ? ` (${status})` : ''}: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (retry >= QUOTA_RETRIES) throw new AnalysisError('quota', '무료 한도 초과, 잠시 후 다시 시도해 주세요.')
      const waitMs = QUOTA_BACKOFF_MS * 2 ** retry
      onProgress?.({ type: 'quota-wait', retry: retry + 1, waitMs })
      await sleep(waitMs, signal)
    }
  }
}

/** 차단·잘림을 오류로 바꾸고 본문 텍스트를 꺼낸다. */
function textOf(response: GenerateContentResponse): string {
  const blockReason = response.promptFeedback?.blockReason
  if (blockReason) throw new AnalysisError('blocked', `요청이 차단되었습니다 (${blockReason}).`)
  const finish = response.candidates?.[0]?.finishReason
  if (finish === 'MAX_TOKENS') {
    throw new AnalysisError('max-tokens', '응답이 출력 한도를 넘어 잘렸습니다. 페이지를 나눠 촬영해 주세요.', response.text)
  }
  if (finish && finish !== 'STOP') throw new AnalysisError('blocked', `응답이 중단되었습니다 (${finish}).`, response.text)
  return response.text ?? ''
}

function parse(raw: string): { ok: true; analysis: Analysis } | { ok: false; problem: string } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    return { ok: false, problem: `JSON 파싱 실패 (${e instanceof Error ? e.message : String(e)})` }
  }
  const result = analysisSchema.safeParse(json)
  if (result.success) return { ok: true, analysis: result.data }
  const issue = result.error.issues[0]
  return { ok: false, problem: `${issue.path.join('.') || '(최상위)'}: ${issue.message}` }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
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

/** 데모 모드: API 없이 fixture를 같은 검증 경로로 돌려준다. */
export async function analyzeDemo(fixture: unknown, signal?: AbortSignal): Promise<AnalyzeResult> {
  await sleep(800, signal)
  const raw = JSON.stringify(fixture)
  const parsed = parse(raw)
  if (!parsed.ok) throw new AnalysisError('invalid', `데모 데이터 형식 오류: ${parsed.problem}`, raw)
  warnInconsistencies(parsed.analysis)
  return { analysis: parsed.analysis, raw }
}
