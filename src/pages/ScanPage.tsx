import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import ReactCrop, { type PercentCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { getPendingFile } from '../lib/pending'
import { useSettings } from '../lib/settings'
import { cropAndResize, loadOriented, rotate90, toBlob } from '../lib/image'
import { AnalysisError, analyzeDemo, analyzePage, type Progress } from '../lib/gemini'
import { DEMO_FIXTURES } from '../lib/demo'
import { setLatestResult } from '../lib/session'

type Phase =
  | { type: 'loading' }
  | { type: 'crop' }
  | { type: 'analyzing'; progress: string; startedAt: number }
  | { type: 'error'; error: AnalysisError | Error }

const INITIAL_CROP: PercentCrop = { unit: '%', x: 4, y: 4, width: 92, height: 92 }

function progressText(p: Progress): string {
  switch (p.type) {
    case 'request':
      return '분석 중… 페이지 하나에 30초~1분 정도 걸립니다.'
    case 'quota-wait':
      return `요청 한도에 걸렸습니다. ${p.waitMs / 1000}초 후 다시 시도합니다 (${p.retry}/2)`
    case 'format-retry':
      return '응답 형식이 맞지 않아 한 번 더 요청하는 중…'
  }
}

export default function ScanPage() {
  const file = getPendingFile()
  const settings = useSettings()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>({ type: 'loading' })
  const [work, setWork] = useState<HTMLCanvasElement | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [crop, setCrop] = useState<PercentCrop>(INITIAL_CROP)
  const [demoKey, setDemoKey] = useState(DEMO_FIXTURES[0].key)
  const [now, setNow] = useState(() => Date.now())
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!file) return
    let cancelled = false
    loadOriented(file)
      .then((c) => {
        if (cancelled) return
        setWork(c)
        setPhase({ type: 'crop' })
      })
      .catch((e) => !cancelled && setPhase({ type: 'error', error: e }))
    return () => {
      cancelled = true
    }
  }, [file])

  // 작업 캔버스가 바뀔 때마다(회전 포함) 화면용 미리보기를 만든다.
  useEffect(() => {
    if (!work) return
    let url: string | null = null
    let cancelled = false
    toBlob(work, 0.8).then((b) => {
      if (cancelled) return
      url = URL.createObjectURL(b)
      setPreview(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [work])

  // 분석 중 경과 시간 표시
  useEffect(() => {
    if (phase.type !== 'analyzing') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [phase.type])

  useEffect(() => () => abortRef.current?.abort(), [])

  if (!file) return <Navigate to="/" replace />
  if (!settings) return <main className="page" />

  const rotate = (clockwise: boolean) => {
    if (!work) return
    setWork(rotate90(work, clockwise))
    setCrop(INITIAL_CROP)
  }

  const analyze = async () => {
    if (!work) return
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()
    setNow(startedAt)
    setPhase({ type: 'analyzing', progress: '이미지 준비 중…', startedAt })
    try {
      const rect = crop.width && crop.height ? { x: crop.x / 100, y: crop.y / 100, width: crop.width / 100, height: crop.height / 100 } : { x: 0, y: 0, width: 1, height: 1 }
      const { blob } = await cropAndResize(work, rect)
      const onProgress = (p: Progress) => setPhase({ type: 'analyzing', progress: progressText(p), startedAt })
      const demo = settings.demoMode ? DEMO_FIXTURES.find((f) => f.key === demoKey)! : null
      onProgress({ type: 'request' })
      const result = demo
        ? await analyzeDemo(await demo.load(), controller.signal)
        : await analyzePage({ image: blob, settings, signal: controller.signal, onProgress })
      setLatestResult({ ...result, image: blob, source: demo ? `데모: ${demo.label}` : settings.model })
      navigate('/result/latest', { replace: true })
    } catch (e) {
      setPhase({ type: 'error', error: e instanceof Error ? e : new Error(String(e)) })
    } finally {
      abortRef.current = null
    }
  }

  return (
    <main className="page stack">
      <h1>자르기 · 회전</h1>

      {phase.type === 'loading' && <p className="dim">사진을 불러오는 중…</p>}

      {phase.type === 'crop' && preview && (
        <>
          <p className="notice">책 한 페이지만 들어가도록 테두리를 맞춰 주세요. 옆 페이지가 걸치면 판독이 섞일 수 있습니다.</p>
          <div className="crop-box">
            <ReactCrop crop={crop} onChange={(_, percent) => setCrop(percent)} keepSelection ruleOfThirds>
              <img src={preview} alt="촬영한 페이지" />
            </ReactCrop>
          </div>
          {settings.demoMode && (
            <div className="field">
              <span className="label">데모 모드 — 사용할 예시 결과</span>
              <div className="segmented" role="group">
                {DEMO_FIXTURES.map((f) => (
                  <button key={f.key} aria-pressed={demoKey === f.key} onClick={() => setDemoKey(f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="action-bar">
            <button className="btn" onClick={() => rotate(false)} aria-label="왼쪽으로 90도 회전">
              ⟲
            </button>
            <button className="btn" onClick={() => rotate(true)} aria-label="오른쪽으로 90도 회전">
              ⟳
            </button>
            <button className="btn btn-primary" style={{ flex: 3 }} onClick={analyze}>
              분석
            </button>
          </div>
        </>
      )}

      {phase.type === 'analyzing' && (
        <div className="card stack analyzing" role="status">
          <div className="spinner" aria-hidden />
          <p>{phase.progress}</p>
          <p className="dim small">{Math.max(0, Math.round((now - phase.startedAt) / 1000))}초 경과</p>
          <button className="btn" onClick={() => abortRef.current?.abort()}>
            취소
          </button>
        </div>
      )}

      {phase.type === 'error' && (
        <div className="stack">
          <p className="notice">{phase.error.message}</p>
          {phase.error instanceof AnalysisError && phase.error.raw !== undefined && (
            <details className="card">
              <summary>모델 원문 응답</summary>
              <pre className="raw-json">{phase.error.raw || '(빈 응답)'}</pre>
            </details>
          )}
          <div className="action-bar">
            <button className="btn btn-primary" onClick={() => setPhase({ type: 'crop' })} disabled={!work}>
              다시 시도
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
