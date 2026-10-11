import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import ReactCrop, { type PercentCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { getPendingFile } from '../lib/pending'
import { useSettings } from '../lib/settings'
import { cropAndResize, loadOriented, rotate90, toBlob } from '../lib/image'
import { DEMO_FIXTURES } from '../lib/demo'
import { startRun } from '../lib/run'

const INITIAL_CROP: PercentCrop = { unit: '%', x: 4, y: 4, width: 92, height: 92 }

export default function ScanPage() {
  const file = getPendingFile()
  const settings = useSettings()
  const navigate = useNavigate()
  const [work, setWork] = useState<HTMLCanvasElement | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [crop, setCrop] = useState<PercentCrop>(INITIAL_CROP)
  const [demoKey, setDemoKey] = useState(DEMO_FIXTURES[0].key)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => {
    if (!file) return
    let cancelled = false
    loadOriented(file)
      .then((c) => !cancelled && setWork(c))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)))
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

  if (!file) return <Navigate to="/" replace />
  if (!settings) return <main className="page" />

  const rotate = (clockwise: boolean) => {
    if (!work) return
    setWork(rotate90(work, clockwise))
    setCrop(INITIAL_CROP)
  }

  // 이미지만 준비하고 바로 결과 화면으로 넘어간다. 분석 진행은 결과 화면에서 보인다.
  const analyze = async () => {
    if (!work) return
    setPreparing(true)
    const rect = crop.width && crop.height ? { x: crop.x / 100, y: crop.y / 100, width: crop.width / 100, height: crop.height / 100 } : { x: 0, y: 0, width: 1, height: 1 }
    const { blob } = await cropAndResize(work, rect)
    const demo = settings.demoMode ? DEMO_FIXTURES.find((f) => f.key === demoKey) : undefined
    startRun({ image: blob, settings, demo })
    navigate('/result/latest')
  }

  return (
    <main className="page stack">
      <h1>자르기 · 회전</h1>

      {loadError && <p className="notice">사진을 불러오지 못했습니다: {loadError}</p>}
      {!loadError && !preview && <p className="dim">사진을 불러오는 중…</p>}

      {preview && (
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
            <button className="btn btn-primary" style={{ flex: 3 }} onClick={analyze} disabled={preparing}>
              분석
            </button>
          </div>
        </>
      )}
    </main>
  )
}
