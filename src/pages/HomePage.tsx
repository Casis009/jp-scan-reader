import { useNavigate } from 'react-router-dom'
import { ScanPicker } from '../components/ScanPicker'
import { useSettings } from '../lib/settings'
import { DEMO_FIXTURES, type DemoFixture } from '../lib/demo'
import { startRun } from '../lib/run'

export default function HomePage() {
  const settings = useSettings()
  const navigate = useNavigate()

  // 데모 모드에서는 사진 없이 예시 결과를 바로 열 수 있다.
  const openDemo = (f: DemoFixture) => {
    if (!settings) return
    startRun({ image: null, settings, demo: f })
    navigate('/result/latest')
  }

  return (
    <main className="page stack">
      <h1>원서스캔</h1>
      <p className="dim small">최근 분석 기록이 여기에 표시됩니다.</p>
      {settings?.demoMode && (
        <section className="card stack">
          <span className="small" style={{ fontWeight: 600 }}>
            데모 모드 — 예시 결과 바로 보기
          </span>
          {DEMO_FIXTURES.map((f) => (
            <button key={f.key} className="btn" onClick={() => openDemo(f)}>
              {f.label}
            </button>
          ))}
        </section>
      )}
      <ScanPicker
        render={(open) => (
          <div className="action-bar">
            <button className="btn" onClick={() => open('gallery')}>
              갤러리
            </button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={() => open('camera')}>
              스캔
            </button>
          </div>
        )}
      />
    </main>
  )
}
