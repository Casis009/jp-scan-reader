import { useState } from 'react'
import type { FuriganaMode, JlptLevel } from '../lib/db'
import type { Token } from '../prompts/schema'
import { isWordToken, showFurigana, type DisplaySentence } from '../lib/display'
import { RubyText } from './RubyText'
import { GrammarCard } from './GrammarCard'

export interface Selection {
  token: Token
  sentence: DisplaySentence
  /** 〓를 눌렀을 때 이 문장에서 몇 번째 〓인지 */
  getaIndex?: number
}

const KIND_LABEL = { body: null, heading: '제목', question: '문제', choice: '선택지' } as const

interface Props {
  sentence: DisplaySentence
  furiganaMode: FuriganaMode
  level: JlptLevel
  selected: Token | null
  onSelect: (selection: Selection) => void
}

export function SentenceCard({ sentence, furiganaMode, level, selected, onSelect }: Props) {
  const [revealed, setRevealed] = useState(false)
  const kindLabel = KIND_LABEL[sentence.kind]
  const hasUncertain = sentence.uncertain.length > 0 || sentence.uncertainNote !== null
  const isChoice = sentence.kind === 'choice'
  // 토큰 위치 → 이 문장에서 몇 번째 〓인지
  const getaOf = new Map<number, number>()
  sentence.tokens.forEach((t, i) => t.surface === '〓' && getaOf.set(i, getaOf.size))

  return (
    <article className={`sentence-card kind-${sentence.kind}${sentence.incomplete ? ' incomplete' : ''}`}>
      {(kindLabel || sentence.incomplete || hasUncertain) && (
        <div className="row badges">
          {kindLabel && <span className="badge">{kindLabel}</span>}
          {sentence.incomplete && <span className="badge badge-warn">페이지에서 잘림</span>}
          {hasUncertain && <span className="badge badge-warn">판독 불확실</span>}
        </div>
      )}

      <p className="jp-text" lang="ja">
        {sentence.tokens.map((t, i) => {
          if (t.surface === '〓') {
            const n = getaOf.get(i)!
            return (
              <button key={i} className="token geta" onClick={() => onSelect({ token: t, sentence, getaIndex: n })} aria-label={`판독 불가 글자 ${n + 1}`} data-geta={n}>
                〓
              </button>
            )
          }
          if (!isWordToken(t)) return <span key={i}>{t.surface}</span>
          return (
            <button key={i} className={`token${selected === t ? ' selected' : ''}`} onClick={() => onSelect({ token: t, sentence })}>
              <RubyText token={t} showRt={showFurigana(t, furiganaMode, level)} />
            </button>
          )
        })}
      </p>

      {hasUncertain && (
        <div className="uncertain-box small">
          {sentence.uncertain.map((u) => (
            <div key={u.index}>
              〓{sentence.uncertain.length > 1 ? ` ${u.index + 1}` : ''} → 후보{' '}
              {u.candidates.length ? (
                <span lang="ja">{u.candidates.join(' · ')}</span>
              ) : (
                <span className="dim">없음</span>
              )}
            </div>
          ))}
          {sentence.uncertainNote && <div>{sentence.uncertainNote}</div>}
        </div>
      )}

      {!isChoice && (
        <div className="reveal">
          {revealed ? (
            <button className="reveal-body" onClick={() => setRevealed(false)}>
              <span className="reading" lang="ja">
                {sentence.reading}
              </span>
              <span className="translation">{sentence.translation ?? '(번역 없음)'}</span>
            </button>
          ) : (
            <button className="reveal-toggle" onClick={() => setRevealed(true)}>
              읽기·번역 보기
            </button>
          )}
        </div>
      )}

      {sentence.grammar.length > 0 && (
        <div className="stack grammar-list">
          {sentence.grammar.map((g, i) => (
            <GrammarCard key={i} grammar={g} />
          ))}
        </div>
      )}
    </article>
  )
}
