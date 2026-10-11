import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { displayableReading } from '../lib/display'
import { RubyText } from './RubyText'
import type { Selection } from './SentenceCard'

/** 단어(또는 〓)를 눌렀을 때 하단 시트에 들어가는 내용 */
export function WordSheet({ selection, recordId }: { selection: Selection; recordId: number | null }) {
  const { sentence, getaIndex } = selection

  if (getaIndex !== undefined) {
    const u = sentence.uncertain.find((x) => x.index === getaIndex)
    return (
      <div className="stack">
        <div className="sheet-word" lang="ja">
          〓
        </div>
        <p>판독할 수 없는 글자입니다.</p>
        <dl className="word-props">
          <dt>후보</dt>
          <dd lang="ja">{u?.candidates.length ? u.candidates.join(' · ') : '없음'}</dd>
          {sentence.uncertainNote && (
            <>
              <dt>메모</dt>
              <dd>{sentence.uncertainNote}</dd>
            </>
          )}
        </dl>
      </div>
    )
  }

  return <WordDetail selection={selection} recordId={recordId} />
}

function WordDetail({ selection, recordId }: { selection: Selection; recordId: number | null }) {
  const { token, sentence } = selection
  const lemma = token.lemma!
  const reading = displayableReading(token.lemmaReading)
  const saved = useLiveQuery(() => db.vocab.where('lemma').equals(lemma).count(), [lemma])

  const add = () =>
    db.vocab.add({
      lemma,
      reading: reading ?? '',
      meaning: token.meaning ?? '',
      pos: token.pos ?? '',
      jlpt: token.jlpt,
      sentence: sentence.text,
      recordId,
      createdAt: Date.now(),
    })

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <span className="sheet-word" lang="ja">
          <RubyText token={token} showRt />
        </span>
        {token.jlpt && <span className="badge">{token.jlpt}</span>}
      </div>
      <dl className="word-props">
        <dt>사전형</dt>
        <dd lang="ja">
          {lemma}
          {reading && reading !== lemma && <span className="dim">【{reading}】</span>}
        </dd>
        {token.pos && (
          <>
            <dt>품사</dt>
            <dd>{token.pos}</dd>
          </>
        )}
        {token.conjugation && (
          <>
            <dt>활용형</dt>
            <dd>{token.conjugation}</dd>
          </>
        )}
        <dt>뜻</dt>
        <dd className="word-meaning">{token.meaning ?? '—'}</dd>
      </dl>
      {token.rubyInSource && <p className="dim small">원문에 후리가나가 인쇄되어 있던 단어입니다.</p>}
      <button className="btn btn-primary btn-block" disabled={!!saved} onClick={add}>
        {saved ? '단어장에 있음' : '단어장 추가'}
      </button>
    </div>
  )
}
