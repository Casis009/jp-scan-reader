import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { FuriganaMode } from '../lib/db'
import { saveSetting, useSettings } from '../lib/settings'
import { getLatestResult } from '../lib/session'
import { prepareForDisplay } from '../lib/display'
import { SentenceCard, type Selection } from '../components/SentenceCard'
import { BottomSheet } from '../components/BottomSheet'
import { WordSheet } from '../components/WordSheet'

const FURIGANA_MODES: { value: FuriganaMode; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'level', label: '내 수준 이상' },
  { value: 'none', label: '숨김' },
]

const DIRECTION_LABEL = { vertical: '세로쓰기', horizontal: '가로쓰기', mixed: '혼합' } as const

export default function ResultPage() {
  const { id } = useParams()
  // 5단계에서 저장된 기록(id)을 읽도록 바뀐다. 지금은 방금 분석한 결과만 있다.
  const result = id === 'latest' ? getLatestResult() : null
  const settings = useSettings()
  const display = useMemo(() => (result ? prepareForDisplay(result.analysis) : null), [result])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl])

  const togglePhoto = () => setPhotoUrl(photoUrl || !result?.image ? null : URL.createObjectURL(result.image))

  if (!result || !display) {
    return (
      <main className="page stack">
        <h1>분석 결과</h1>
        <p className="dim">표시할 결과가 없습니다. 기록 저장은 5단계에서 추가됩니다.</p>
        <Link to="/">홈으로</Link>
      </main>
    )
  }
  if (!settings) return <main className="page" />

  const { layout, pageNote, sentences } = display

  return (
    <main className="page stack">
      <h1>분석 결과</h1>
      <p className="dim small">
        {DIRECTION_LABEL[layout.direction]} · 문장 {sentences.length}개 · {result.source}
      </p>

      <div className="segmented" role="group" aria-label="후리가나 표시">
        {FURIGANA_MODES.map((m) => (
          <button key={m.value} aria-pressed={settings.furiganaMode === m.value} onClick={() => saveSetting('furiganaMode', m.value)}>
            {m.label}
          </button>
        ))}
      </div>

      {pageNote && <p className="notice">{pageNote}</p>}

      {result.image && (
        <div className="stack">
          <button className="btn" onClick={togglePhoto}>
            {photoUrl ? '원본 사진 닫기' : '원본 사진 보기'}
          </button>
          {photoUrl && <img className="source-photo" src={photoUrl} alt="분석한 페이지 원본" />}
        </div>
      )}

      {sentences.length === 0 && <p className="dim">판독된 문장이 없습니다.</p>}

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

      <details className="card">
        <summary className="small">원시 JSON</summary>
        <pre className="raw-json">{JSON.stringify(result.analysis, null, 2)}</pre>
      </details>

      <BottomSheet open={selection !== null} onClose={() => setSelection(null)}>
        {selection && <WordSheet selection={selection} recordId={null} />}
      </BottomSheet>
    </main>
  )
}
