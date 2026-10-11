import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type FuriganaMode } from '../lib/db'
import { saveSetting, useSettings } from '../lib/settings'
import { cancelRun, lastRunModel, retryRun, startRun, useRun, type RunState } from '../lib/run'
import { nextModel } from '../lib/models'
import { getPendingFile } from '../lib/pending'
import { prepareForDisplay } from '../lib/display'
import { DEMO_FIXTURES } from '../lib/demo'
import { deleteRecord } from '../lib/records'
import { AnalysisError, type Progress, type Stats } from '../lib/gemini'
import type { Layout, Sentence } from '../prompts/schema'
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
  const live = useRun()
  const location = useLocation()
  const recordId = id === 'latest' ? null : Number(id)
  // 방금 끝나 저장되면서 주소만 바뀐 경우에는 진행 화면을 그대로 이어서 보여 준다(읽던 위치·열린 번역 유지).
  // 홈 목록이나 캐시로 연 경우(fromLive 없음)는 저장된 기록을 연다.
  const fromLive = (location.state as { fromLive?: boolean } | null)?.fromLive === true
  if (id === 'latest' || (fromLive && live?.recordId === recordId)) return <LiveResult run={live} />
  return <RecordResult id={recordId!} />
}

function LiveResult({ run }: { run: RunState | null }) {
  const { id } = useParams()
  const navigate = useNavigate()

  // 저장이 끝나면 주소를 기록 주소로 바꾼다. 같은 컴포넌트가 그대로 이어진다.
  useEffect(() => {
    if (id === 'latest' && run?.recordId !== undefined) navigate(`/result/${run.recordId}`, { replace: true, state: { fromLive: true } })
  }, [id, run?.recordId, navigate])

  if (!run) return <Empty text="표시할 결과가 없습니다." />

  return (
    <ResultView
      layout={run.layout}
      pageNote={run.pageNote}
      sentences={run.sentences}
      image={run.image}
      source={run.source}
      stats={run.status === 'done' ? run.stats : undefined}
      json={run.status === 'done' ? run.raw : undefined}
      recordId={run.recordId ?? null}
      running={run.status === 'running'}
      emptyText={run.status === 'done' ? '판독된 문장이 없습니다.' : null}
    >
      {run.status === 'error' && run.error && <ErrorBox run={run} onRecrop={getPendingFile() ? () => navigate('/scan') : undefined} />}
      {run.saveError && <p className="notice">기록 저장에 실패했습니다: {run.saveError}</p>}
      {run.status === 'done' && run.recordId !== undefined && <RecordActions id={run.recordId} />}
      {run.status === 'running' && <ProgressBar run={run} />}
    </ResultView>
  )
}

function RecordResult({ id }: { id: number }) {
  const record = useLiveQuery(() => db.records.get(id).then((r) => r ?? null), [id])
  const [params] = useSearchParams()

  if (record === undefined) return <main className="page" />
  if (record === null) return <Empty text="기록을 찾을 수 없습니다. 삭제되었을 수 있습니다." />

  return (
    <ResultView
      layout={record.analysis.layout}
      pageNote={record.analysis.pageNote}
      sentences={record.analysis.sentences}
      image={record.image}
      source={`${record.model} · ${new Date(record.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`}
      stats={record.stats}
      json={JSON.stringify(record.analysis, null, 2)}
      recordId={id}
      running={false}
      emptyText="판독된 문장이 없습니다."
      notice={params.get('cached') ? '이미 분석한 사진이라 저장된 결과를 불러왔습니다. API는 호출하지 않았습니다.' : null}
    >
      <RecordActions id={id} />
    </ResultView>
  )
}

/** 저장된 기록의 [새로 분석]·[기록 삭제] */
function RecordActions({ id }: { id: number }) {
  const record = useLiveQuery(() => db.records.get(id), [id])
  const settings = useSettings()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!record || !settings) return null

  const demo = record.demoKey ? DEMO_FIXTURES.find((f) => f.key === record.demoKey) : undefined
  const canReanalyze = !record.demoKey || demo !== undefined

  // 캐시를 건너뛰고 API를 다시 부른다. 끝나면 같은 기록을 새 결과로 덮어쓴다.
  const reanalyze = () => {
    startRun({ image: record.image, settings, demo, hash: record.hash })
    navigate('/result/latest')
  }
  const remove = async () => {
    await deleteRecord(id)
    navigate('/', { replace: true })
  }

  return (
    <div className="row" style={{ flexWrap: 'wrap' }}>
      {canReanalyze && (
        <button className="btn" style={{ flex: 1 }} onClick={reanalyze}>
          새로 분석
        </button>
      )}
      {confirmDelete ? (
        <>
          <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>
            취소
          </button>
          <button className="btn btn-danger" style={{ flex: 1 }} onClick={remove}>
            삭제 확인
          </button>
        </>
      ) : (
        <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => setConfirmDelete(true)}>
          기록 삭제
        </button>
      )}
    </div>
  )
}

interface ViewProps {
  layout: Layout | null
  pageNote: string | null
  sentences: Sentence[]
  image: Blob | null
  source: string
  stats?: Stats
  /** "원시 JSON"에 보여 줄 내용 */
  json?: string
  recordId: number | null
  running: boolean
  emptyText: string | null
  notice?: string | null
  /** 문장 목록 아래에 놓을 오류·동작 버튼 등 */
  children?: ReactNode
}

function ResultView({ layout, pageNote, sentences, image, source, stats, json, recordId, running, emptyText, notice, children }: ViewProps) {
  const settings = useSettings()
  const display = useMemo(() => prepareForDisplay({ layout: layout ?? { direction: 'vertical', confidence: 0 }, pageNote, sentences }), [layout, pageNote, sentences])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl])

  if (!settings) return <main className="page" />

  const togglePhoto = () => setPhotoUrl(photoUrl || !image ? null : URL.createObjectURL(image))

  return (
    <main className={`page stack${running ? ' with-progress' : ''}`}>
      <h1>분석 결과</h1>
      <p className="dim small">
        {layout ? DIRECTION_LABEL[layout.direction] : '방향 판독 중'} · 문장 {display.sentences.length}개 · {source}
      </p>
      {notice && <p className="notice">{notice}</p>}

      <div className="segmented" role="group" aria-label="후리가나 표시">
        {FURIGANA_MODES.map((m) => (
          <button key={m.value} aria-pressed={settings.furiganaMode === m.value} onClick={() => saveSetting('furiganaMode', m.value)}>
            {m.label}
          </button>
        ))}
      </div>

      {pageNote && <p className="notice">{pageNote}</p>}

      {image && (
        <div className="stack">
          <button className="btn" onClick={togglePhoto}>
            {photoUrl ? '원본 사진 닫기' : '원본 사진 보기'}
          </button>
          {photoUrl && <img className="source-photo" src={photoUrl} alt="분석한 페이지 원본" />}
        </div>
      )}

      {emptyText && display.sentences.length === 0 && <p className="dim">{emptyText}</p>}

      {display.sentences.map((s) => (
        <SentenceCard
          key={s.id}
          sentence={s}
          furiganaMode={settings.furiganaMode}
          level={settings.level}
          selected={selection?.token ?? null}
          onSelect={setSelection}
        />
      ))}

      {children}

      {json !== undefined && (
        <details className="card">
          <summary className="small">원시 JSON</summary>
          <pre className="raw-json">{json}</pre>
        </details>
      )}

      {settings.showStats && stats && <StatsLine stats={stats} />}

      <BottomSheet open={selection !== null} onClose={() => setSelection(null)}>
        {selection && <WordSheet selection={selection} recordId={recordId} />}
      </BottomSheet>
    </main>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <main className="page stack">
      <h1>분석 결과</h1>
      <p className="dim">{text}</p>
      <Link to="/">홈으로</Link>
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

function StatsLine({ stats }: { stats: Stats }) {
  const parts = [`분석 ${stats.seconds}초`]
  if (stats.firstSentenceSeconds !== null) parts.push(`첫 문장 ${stats.firstSentenceSeconds}초`)
  if (stats.outputTokens !== undefined) parts.push(`출력 ${stats.outputTokens.toLocaleString()}토큰`)
  if (stats.thoughtsTokens) parts.push(`생각 ${stats.thoughtsTokens.toLocaleString()}토큰`)
  return <p className="dim small stats-line">{parts.join(' · ')}</p>
}
