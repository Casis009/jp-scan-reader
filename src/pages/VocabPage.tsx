import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type JlptLevel, type VocabEntry } from '../lib/db'
import { toAnkiCsv } from '../lib/csv'
import { downloadText } from '../lib/backup'

type LevelFilter = 'all' | JlptLevel | 'none'
const FILTERS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'N5', label: 'N5' },
  { value: 'N4', label: 'N4' },
  { value: 'N3', label: 'N3' },
  { value: 'N2', label: 'N2' },
  { value: 'N1', label: 'N1' },
  { value: 'none', label: '외' },
]

export default function VocabPage() {
  const entries = useLiveQuery(() => db.vocab.orderBy('createdAt').reverse().toArray())
  const [level, setLevel] = useState<LevelFilter>('all')
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (entries ?? []).filter((e) => {
      if (level === 'none' ? e.jlpt !== null : level !== 'all' && e.jlpt !== level) return false
      return !q || [e.lemma, e.reading, e.meaning].some((s) => s.toLowerCase().includes(q))
    })
  }, [entries, level, query])

  const exportCsv = () => {
    const date = new Date().toISOString().slice(0, 10)
    downloadText(`anki-vocab-${date}.csv`, toAnkiCsv(shown), 'text/csv;charset=utf-8')
  }

  return (
    <main className="page stack">
      <h1>단어장</h1>
      <div className="segmented" role="group" aria-label="레벨 필터">
        {FILTERS.map((f) => (
          <button key={f.value} aria-pressed={level === f.value} onClick={() => setLevel(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="field">
        <input type="search" placeholder="단어·읽기·뜻 검색" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="단어 검색" />
      </div>

      {entries === undefined ? null : entries.length === 0 ? (
        <p className="dim">아직 단어가 없습니다. 분석 결과에서 단어를 눌러 [단어장 추가]를 눌러 보세요.</p>
      ) : (
        <>
          <p className="dim small">
            {shown.length}개{shown.length !== entries.length && ` / 전체 ${entries.length}개`}
          </p>
          {shown.map((e) => (
            <VocabItem key={e.id} entry={e} />
          ))}
        </>
      )}

      {shown.length > 0 && (
        <div className="action-bar">
          <button className="btn btn-primary" onClick={exportCsv}>
            Anki용 CSV 내보내기 ({shown.length}개)
          </button>
        </div>
      )}
    </main>
  )
}

function VocabItem({ entry }: { entry: VocabEntry }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  // 출처 기록이 아직 있는지(삭제됐을 수 있다)
  const recordExists = useLiveQuery(async () => (entry.recordId === null ? false : (await db.records.get(entry.recordId)) !== undefined), [entry.recordId])

  return (
    <article className="card vocab-item">
      <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="vocab-lemma" lang="ja">
          {entry.lemma}
        </span>
        {entry.reading && entry.reading !== entry.lemma && (
          <span className="dim" lang="ja">
            {entry.reading}
          </span>
        )}
        {entry.jlpt && <span className="badge">{entry.jlpt}</span>}
      </div>
      <p className="vocab-meaning">
        {entry.meaning}
        {entry.pos && <span className="dim small"> · {entry.pos}</span>}
      </p>
      {open && (
        <div className="vocab-source">
          <p lang="ja">{entry.sentence || '(출처 문장 없음)'}</p>
          {recordExists && (
            <Link className="small" to={`/result/${entry.recordId}`}>
              분석 기록 열기
            </Link>
          )}
        </div>
      )}
      <div className="row">
        <button className="btn" style={{ flex: 1 }} onClick={() => setOpen(!open)}>
          {open ? '출처 닫기' : '출처 문장'}
        </button>
        {confirm ? (
          <>
            <button className="btn" onClick={() => setConfirm(false)}>
              취소
            </button>
            <button className="btn btn-danger" onClick={() => db.vocab.delete(entry.id!)}>
              삭제 확인
            </button>
          </>
        ) : (
          <button className="btn btn-danger" onClick={() => setConfirm(true)}>
            삭제
          </button>
        )}
      </div>
    </article>
  )
}
