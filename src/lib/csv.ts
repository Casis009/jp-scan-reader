import type { VocabEntry } from './db'

/** CSV 필드: 항상 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다. */
function field(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Anki 가져오기용 CSV. 앞면: 단어(사전형), 뒷면: 읽기<br>뜻<br>예문.
 * 첫 줄들의 #separator·#html·#columns는 Anki 2.1.55 이상이 읽는 파일 헤더다.
 * 읽기가 단어와 같으면(가나 단어) 뒷면에서 뺀다.
 */
export function toAnkiCsv(entries: Pick<VocabEntry, 'lemma' | 'reading' | 'meaning' | 'sentence'>[]): string {
  const lines = ['#separator:comma', '#html:true', '#columns:앞면,뒷면']
  for (const e of entries) {
    const back = [e.reading !== e.lemma ? e.reading : '', e.meaning, e.sentence].filter(Boolean).map(escapeHtml).join('<br>')
    lines.push(`${field(escapeHtml(e.lemma))},${field(back)}`)
  }
  return lines.join('\n') + '\n'
}
