import type { Grammar } from '../prompts/schema'

export function GrammarCard({ grammar }: { grammar: Grammar }) {
  return (
    <div className="grammar-card">
      <div className="row">
        <span className="grammar-pattern" lang="ja">
          {grammar.pattern}
        </span>
        {grammar.level && <span className="badge">{grammar.level}</span>}
      </div>
      <p>{grammar.explanation}</p>
      <p className="grammar-usage">
        <span className="dim small">이 문장에서 · </span>
        {grammar.usage}
      </p>
    </div>
  )
}
