import { useSyncExternalStore } from 'react'
import type { Settings } from './db'
import type { DemoFixture } from './demo'
import { AnalysisError, analyzeDemo, analyzePage, type Progress, type Stats, type StreamHandlers } from './gemini'
import type { Analysis, Layout, Sentence } from '../prompts/schema'
import { saveRecord } from './records'

/**
 * 진행 중이거나 방금 끝난 분석 하나. 끝나면 이미지가 있는 분석은 IndexedDB 기록으로 저장한다.
 * 결과 화면은 useRun()으로 구독해 문장이 도착하는 대로 그린다.
 */
export interface RunState {
  id: number
  status: 'running' | 'done' | 'error'
  startedAt: number
  progress: Progress
  layout: Layout | null
  pageNote: string | null
  sentences: Sentence[]
  raw?: string
  stats?: Stats
  error?: Error
  image: Blob | null
  source: string
  /** 저장된 기록 id(저장이 끝난 뒤) */
  recordId?: number
  saveError?: string
}

interface RunInput {
  image: Blob | null
  settings: Settings
  demo?: DemoFixture
  /** 캐시 키(lib/records.ts cacheKey). 있으면 끝난 뒤 이 키로 기록을 저장한다. */
  hash?: string
}

let state: RunState | null = null
let lastInput: RunInput | null = null
let controller: AbortController | null = null
let nextId = 1
const listeners = new Set<() => void>()

function set(id: number, patch: Partial<RunState> | ((s: RunState) => Partial<RunState>)) {
  if (!state || state.id !== id) return // 이미 새 분석이 시작됐으면 무시
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  listeners.forEach((l) => l())
}

export function useRun(): RunState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function startRun(input: RunInput) {
  controller?.abort()
  const id = nextId++
  const ctrl = new AbortController()
  controller = ctrl
  lastInput = input
  state = {
    id,
    status: 'running',
    startedAt: Date.now(),
    progress: { type: 'request' },
    layout: null,
    pageNote: null,
    sentences: [],
    image: input.image,
    source: input.demo ? `데모: ${input.demo.label}` : input.settings.model,
  }
  listeners.forEach((l) => l())

  const handlers: StreamHandlers = {
    onProgress: (progress) => set(id, { progress }),
    onLayout: (layout) => set(id, { layout }),
    onPageNote: (pageNote) => set(id, { pageNote }),
    onSentence: (s) => set(id, (st) => ({ sentences: [...st.sentences, s] })),
    onReset: () => set(id, { sentences: [], layout: null, pageNote: null }),
  }

  const task = input.demo
    ? input.demo.load().then((fixture) => analyzeDemo(fixture, { signal: ctrl.signal, handlers }))
    : analyzePage({ image: input.image!, settings: input.settings, signal: ctrl.signal, handlers })

  task
    .then(({ analysis, raw, stats }) => {
      set(id, { status: 'done', ...fromAnalysis(analysis), raw, stats })
      const { image, hash, demo, settings } = input
      if (!image || !hash) return
      saveRecord({ hash, image, analysis, stats, model: demo ? `데모: ${demo.label}` : settings.model, demoKey: demo?.key })
        .then((recordId) => set(id, { recordId }))
        .catch((e) => {
          console.error('[analysis] 기록 저장 실패', e)
          set(id, { saveError: e instanceof Error ? e.message : String(e) })
        })
    })
    .catch((e) => set(id, { status: 'error', error: e instanceof Error ? e : new Error(String(e)), raw: e instanceof AnalysisError ? e.raw : undefined }))
    .finally(() => {
      if (controller === ctrl) controller = null
    })
}

function fromAnalysis(a: Analysis): Pick<RunState, 'layout' | 'pageNote' | 'sentences'> {
  return { layout: a.layout, pageNote: a.pageNote, sentences: a.sentences }
}

export function cancelRun() {
  controller?.abort()
}

/** 같은 이미지·설정으로 다시 분석한다. model을 주면 이번 한 번만 그 모델을 쓴다(설정은 그대로). */
export function retryRun(model?: string) {
  if (!lastInput) return
  startRun(model ? { ...lastInput, settings: { ...lastInput.settings, model } } : lastInput)
}

/** 마지막 분석에 쓴 모델. 데모면 null. */
export function lastRunModel(): string | null {
  return lastInput && !lastInput.demo ? lastInput.settings.model : null
}
