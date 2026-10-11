import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { FuriganaMode } from '../lib/db'
import { saveSetting, useSettings } from '../lib/settings'
import { cancelRun, lastRunModel, retryRun, useRun, type RunState } from '../lib/run'
import { nextModel } from '../lib/models'
import { getPendingFile } from '../lib/pending'
import { prepareForDisplay } from '../lib/display'
import { AnalysisError, type Progress } from '../lib/gemini'
import { SentenceCard, type Selection } from '../components/SentenceCard'
import { BottomSheet } from '../components/BottomSheet'
import { WordSheet } from '../components/WordSheet'

const FURIGANA_MODES: { value: FuriganaMode; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'level', label: '내 수준 이상' },
  { value: 'none', label: '숨김' },
]

const DIRECTION_LABEL = { vertical: '세로쓰기', horizontal: '가로쓰기', mixed: '혼합' } as const

function progressText(p: Progress): string {
  switch (p.type) {
    case 'request':
      return '페이지 판독 중…'
    case 'sentence':
      return `${p.done + 1}번째 문장 분석 중…`
    case 'retry-wait':
      return `${p.reason === 'quota' ? '요청 한도에 걸렸습니다' : 'Google 서버가 혼잡합니다'}. ${p.waitMs / 1000}초 후 다시 시도합니다 (${p.retry}/2)`
    case 'format-retry':
      return '응답 형식이 맞지 않아 처음부터 다시 받는 중…'
  }
}

export default function ResultPage() {
  const { id } = useParams()
  // 5단계에서 저장된 기록(id)을 읽도록 바뀐다. 지금은 진행 중이거나 방금 끝난 분석만 있다.
  const live = useRun()
  const run = id === 'latest' ? live : null
  const settings = useSettings()
  const navigate = useNavigate()
  const display = useMemo(
    () => (run ? prepareForDisplay({ layout: run.layout ?? { direction: 'vertical', confidence: 0 }, pageNote: run.pageNote, sentences: run.sentences }) : null),
    [run],
  )
  const [selection, setSelection] = useState<Selection | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl])

  if (!run || !display) {
    return (
      <main className="page stack">
        <h1>분석 결과</h1>
        <p className="dim">표시할 결과가 없습니다. 기록 저장은 5단계에서 추가됩니다.</p>
        <Link to="/">홈으로</Link>
      </main>
    )
  }
  if (!settings) return <main className="page" />

  const togglePhoto = () => setPhotoUrl(photoUrl || !run.image ? null : URL.createObjectURL(run.image))
  const { sentences } = display
  const running = run.status === 'running'

  return (
    <main className={`page stack${running ? ' with-progress' : ''}`}>
      <h1>분석 결과</h1>
      <p className="dim small">
        {run.layout ? DIRECTION_LABEL[run.layout.direction] : '방향 판독 중'} · 문장 {sentences.length}개 · {run.source}
      </p>

      <div className="segmented" role="group" aria-label="후리가나 표시">
        {FURIGANA_MODES.map((m) => (
          <button key={m.value} aria-pressed={settings.furiganaMode === m.value} onClick={() => saveSetting('furiganaMode', m.value)}>
            {m.label}
          </button>
        ))}
      </div>

      {run.pageNote && <p className="notice">{run.pageNote}</p>}

      {run.image && (
        <div className="stack">
          <button className="btn" onClick={togglePhoto}>
            {photoUrl ? '원본 사진 닫기' : '원본 사진 보기'}
          </button>
          {photoUrl && <img className="source-photo" src={photoUrl} alt="분석한 페이지 원본" />}
        </div>
      )}

      {run.status === 'done' && sentences.length === 0 && <p className="dim">판독된 문장이 없습니다.</p>}

      {sentences.map((s) => (
        <SentenceCard
          key={s.id}
          sentence={s}
          furiganaMode={settings.furiganaMode}
          level={settings.level}
          selected={selection?.token ?? null}
          onSelect={setSelection}
        />
      ))}

      {run.status === 'error' && run.error && <ErrorBox run={run} onRecrop={getPendingFile() ? () => navigate('/scan') : undefined} />}

      {run.status === 'done' && (
        <details className="card">
          <summary className="small">원시 JSON</summary>
          <pre className="raw-json">{run.raw}</pre>
        </details>
      )}

      {run.status === 'done' && settings.showStats && run.stats && <StatsLine stats={run.stats} />}

      {running && <ProgressBar run={run} />}

      <BottomSheet open={selection !== null} onClose={() => setSelection(null)}>
        {selection && <WordSheet selection={selection} recordId={null} />}
      </BottomSheet>
    </main>
  )
}

function ProgressBar({ run }: { run: RunState }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="progress-bar" role="status">
      <div className="spinner spinner-sm" aria-hidden />
      <div className="progress-text">
        <span>{progressText(run.progress)}</span>
        <span className="dim small">{Math.max(0, Math.round((now - run.startedAt) / 1000))}초 경과</span>
      </div>
      <button className="btn" onClick={cancelRun}>
        취소
      </button>
    </div>
  )
}

function ErrorBox({ run, onRecrop }: { run: RunState; onRecrop?: () => void }) {
  const error = run.error!
  const kind = error instanceof AnalysisError ? error.kind : null
  const detail = error instanceof AnalysisError ? error.detail : undefined
  const usedModel = lastRunModel()
  // 서버 혼잡이면 목록의 다음 모델로 이번 한 번만 다시 분석할 수 있게 한다.
  const alternative = kind === 'overloaded' && usedModel ? nextModel(usedModel) : null

  return (
    <div className="stack">
      <p className="notice">{error.message}</p>
      {kind !== 'overloaded' && run.raw !== undefined && (
        <details className="card">
          <summary className="small">모델 원문 응답</summary>
          <pre className="raw-json">{run.raw || '(빈 응답)'}</pre>
        </details>
      )}
      {detail && (
        <details className="card">
          <summary className="small">자세히 보기</summary>
          <pre className="raw-json error-detail">{detail}</pre>
        </details>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {onRecrop && (
          <button className="btn" style={{ flex: 1 }} onClick={onRecrop}>
            다시 자르기
          </button>
        )}
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => retryRun()}>
          다시 분석
        </button>
        {alternative && (
          <button className="btn btn-block" onClick={() => retryRun(alternative.id)}>
            다른 모델로 분석 ({alternative.label})
          </button>
        )}
      </div>
    </div>
  )
}

function StatsLine({ stats }: { stats: NonNullable<RunState['stats']> }) {
  const parts = [`분석 ${stats.seconds}초`]
  if (stats.firstSentenceSeconds !== null) parts.push(`첫 문장 ${stats.firstSentenceSeconds}초`)
  if (stats.outputTokens !== undefined) parts.push(`출력 ${stats.outputTokens.toLocaleString()}토큰`)
  if (stats.thoughtsTokens) parts.push(`생각 ${stats.thoughtsTokens.toLocaleString()}토큰`)
  return <p className="dim small stats-line">{parts.join(' · ')}</p>
}
