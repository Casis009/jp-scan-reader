import { describe, expect, it } from 'vitest'
import { toAnkiCsv } from '../src/lib/csv'

describe('Anki CSV', () => {
  it('앞면: 단어, 뒷면: 읽기<br>뜻<br>예문', () => {
    const csv = toAnkiCsv([{ lemma: '取り扱い', reading: 'とりあつかい', meaning: '취급, 다루기', sentence: '「この箱の取り扱いには気をつけてください」と祖母は言った。' }])
    expect(csv).toBe(
      '#separator:comma\n#html:true\n#columns:앞면,뒷면\n' +
        '"取り扱い","とりあつかい<br>취급, 다루기<br>「この箱の取り扱いには気をつけてください」と祖母は言った。"\n',
    )
  })

  it('큰따옴표·쉼표·줄바꿈·HTML 문자를 안전하게 넣는다', () => {
    const csv = toAnkiCsv([{ lemma: 'A"B', reading: 'えー', meaning: '<뜻>, & "인용"', sentence: '첫 줄\n둘째 줄' }])
    const row = csv.split('\n').slice(3).join('\n')
    expect(row).toBe('"A""B","えー<br>&lt;뜻&gt;, &amp; ""인용""<br>첫 줄\n둘째 줄"\n')
  })

  it('읽기가 단어와 같거나 비어 있으면 뒷면에서 뺀다', () => {
    const csv = toAnkiCsv([
      { lemma: 'もの', reading: 'もの', meaning: '것', sentence: '' },
      { lemma: '机', reading: '', meaning: '책상', sentence: '机に' },
    ])
    expect(csv.split('\n').slice(3, 5)).toEqual(['"もの","것"', '"机","책상<br>机に"'])
  })
})
