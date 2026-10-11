import type { Token } from '../prompts/schema'
import { isKana } from '../lib/kana'

/** 토큰의 ruby 조각을 <ruby>로 그린다. 가나가 아닌 rt는 그리지 않는다. */
export function RubyText({ token, showRt }: { token: Token; showRt: boolean }) {
  return (
    <>
      {token.ruby.map((part, i) =>
        showRt && part.rt && isKana(part.rt) ? (
          <ruby key={i}>
            {part.base}
            <rp>(</rp>
            <rt>{part.rt}</rt>
            <rp>)</rp>
          </ruby>
        ) : (
          <span key={i}>{part.base}</span>
        ),
      )}
    </>
  )
}
