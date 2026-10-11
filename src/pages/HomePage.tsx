import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ScanPicker } from '../components/ScanPicker'
import { useSettings } from '../lib/settings'
import { DEMO_FIXTURES, type DemoFixture } from '../lib/demo'
import { startRun } from '../lib/run'
import { db } from '../lib/db'

export default function HomePage() {
  const settings = useSettings()
  const navigate = useNavigate()
  // 목록에는 큰 원본 이미지가 필요 없지만 Dexie는 필드 단위로 읽지 못해 최근 50개로 제한한다.
  const records = useLiveQuery(() => db.records.orderBy('createdAt').reverse().limit(50).toArray())

  // 데모 모드에서는 사진 없이 예시 결과를 바로 열 수 있다(기록에는 남지 않는다).
  const openDemo = (f: DemoFixture) => {
    if (!settings) return
    startRun({ image: null, settings, demo: f })
    navigate('/result/latest')
  }

  return (
    <main className="page stack">
      <h1>원서스캔</h1>

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

      <section className="stack">
        <h2 className="section-title">최근 분석</h2>
        {records?.length === 0 && <p className="dim small">아직 분석 기록이 없습니다. 아래 [스캔]으로 책 페이지를 찍어 보세요.</p>}
        {records?.map((r) => (
          <Link key={r.id} to={`/result/${r.id}`} className="record-item">
            <img src={r.thumbnail} alt="" className="record-thumb" />
            <span className="record-body">
              <span className="record-first" lang="ja">
                {r.firstSentence || '(문장 없음)'}
              </span>
              <span className="dim small">
                {new Date(r.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })} · 문장 {r.analysis.sentences.length}개
                {r.demoKey ? ' · 데모' : ''}
              </span>
            </span>
          </Link>
        ))}
      </section>

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
