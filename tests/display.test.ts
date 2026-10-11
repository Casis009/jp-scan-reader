import { describe, expect, it, vi } from 'vitest'
import novel from './fixtures/novel-vertical.json'
import jlpt from './fixtures/jlpt-horizontal.json'
import { analysisSchema, findInconsistencies, warnInconsistencies, type Analysis, type Token } from '../src/prompts/schema'
import { displayableReading, prepareForDisplay, sentenceReading, showFurigana } from '../src/lib/display'
import { isKana, toHiragana } from '../src/lib/kana'

const tok = (surface: string, ruby: [string, string][], extra: Partial<Token> = {}): Token => ({
  surface,
  ruby: ruby.map(([base, rt]) => ({ base, rt })),
  lemma: surface,
  lemmaReading: null,
  pos: null,
  conjugation: null,
  meaning: null,
  jlpt: null,
  rubyInSource: false,
  ...extra,
})

describe('문장 읽기 계산', () => {
  it('fixture 문장들의 읽기', () => {
    const n = prepareForDisplay(analysisSchema.parse(novel)).sentences
    expect(n[1].reading).toBe('きょうはあさからあめがふっていた')
    expect(n[2].reading).toBe('このはこのとりあつかいにはきをつけてくださいとそぼはいった')
    expect(n[3].reading).toBe('はこのなかにはいろの〓せたてがみがいっつうはいっていた')
    const j = prepareForDisplay(analysisSchema.parse(jlpt)).sentences
    expect(j[2].reading).toBe('このきかいはきょうじゅうにしゅうりことになっている')
  })

  it('가타카나는 히라가나로, ー는 그대로', () => {
    expect(sentenceReading([tok('コーヒー', [['コーヒー', '']]), tok('。', [['。', '']])])).toBe('こーひー')
  })

  it('숫자+조수사 루비 하나', () => {
    expect(sentenceReading([tok('1杯', [['1杯', 'いっぱい']])])).toBe('いっぱい')
  })

  it('가나가 아닌 rt는 무시하고 base를 쓴다', () => {
    expect(sentenceReading([tok('机', [['机', '도']]), tok('に', [['に', '']])])).toBe('机に')
  })
})

describe('문장부호만 있는 문장은 앞 문장에 합친다', () => {
  const base = analysisSchema.parse(novel)
  const punctOnly = { ...base.sentences[1], id: 99, text: '」。', tokens: [tok('」', [['」', '']], { lemma: null }), tok('。', [['。', '']], { lemma: null })], grammar: [] }
  const withStray: Analysis = { ...base, sentences: [base.sentences[0], base.sentences[1], punctOnly, base.sentences[2]] }

  it('합쳐진다', () => {
    const s = prepareForDisplay(withStray).sentences
    expect(s).toHaveLength(3)
    expect(s[1].text).toBe('今日は朝から雨が降っていた。」。')
    expect(s[1].tokens.map((t) => t.surface).join('')).toBe(s[1].text)
  })

  it('첫 문장이면 그대로 둔다', () => {
    expect(prepareForDisplay({ ...base, sentences: [punctOnly, base.sentences[1]] }).sentences).toHaveLength(2)
  })

  it('〓만 있는 문장은 문장부호로 보지 않는다', () => {
    const geta = { ...punctOnly, text: '〓', tokens: [tok('〓', [['〓', '']], { lemma: null })] }
    expect(prepareForDisplay({ ...base, sentences: [base.sentences[1], geta] }).sentences).toHaveLength(2)
  })
})

describe('가나 검사', () => {
  it('isKana / toHiragana', () => {
    expect(isKana('とりあつかい')).toBe(true)
    expect(isKana('コーヒー')).toBe(true)
    expect(isKana('')).toBe(true)
    expect(isKana('도')).toBe(false)
    expect(isKana('机')).toBe(false)
    expect(isKana('a')).toBe(false)
    expect(toHiragana('コーヒー')).toBe('こーひー')
  })

  it('lemmaReading·rt에 가나가 아니면 경고, 시트에서는 숨김', () => {
    const broken = structuredClone(novel)
    broken.sentences[1].tokens[0].lemmaReading = '도'
    broken.sentences[1].tokens[2].ruby[0].rt = 'asa'
    const parsed = analysisSchema.parse(broken)
    expect(findInconsistencies(parsed).map((i) => i.message)).toEqual([
      '"今日"의 lemmaReading에 가나 이외 문자: "도"',
      '"朝"의 rt에 가나 이외 문자: "asa"',
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnInconsistencies(parsed)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
    expect(displayableReading('도')).toBeNull()
    expect(displayableReading('きょう')).toBe('きょう')
  })
})

describe('후리가나 표시 모드', () => {
  const n3 = tok('修理', [['修理', 'しゅうり']], { jlpt: 'N3' })
  const n5 = tok('雨', [['雨', 'あめ']], { jlpt: 'N5' })
  const n1 = tok('封', [['封', 'ふう']], { jlpt: 'N1' })
  const none = tok('褪せる', [['褪', 'あ']], { jlpt: null })

  it('level 모드: 학습자 수준 이상 + 등급 외', () => {
    expect([n5, n3, n1, none].map((t) => showFurigana(t, 'level', 'N3'))).toEqual([false, true, true, true])
  })
  it('all / none', () => {
    expect(showFurigana(n5, 'all', 'N1')).toBe(true)
    expect(showFurigana(n1, 'none', 'N5')).toBe(false)
  })
})
