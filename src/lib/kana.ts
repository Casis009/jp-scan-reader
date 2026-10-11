/** 히라가나·가타카나(반복 부호 포함)와 장음 부호 ー만으로 된 문자열인지. 빈 문자열은 true. */
export function isKana(s: string): boolean {
  return /^[ぁ-ゖゝゞァ-ヺー-ヾ]*$/.test(s)
}

/** 가타카나를 히라가나로 바꾼다. ー 등 대응하는 히라가나가 없는 문자는 그대로 둔다. */
export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶヽヾ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

/** 문장부호·기호·공백. 판독 불가 표시 〓는 내용으로 보므로 제외한다. */
const PUNCT = /[\p{P}\p{S}\p{Z}\s]/u

export function isPunctuationChar(c: string): boolean {
  return c !== '〓' && PUNCT.test(c)
}

export function isPunctuationOnly(s: string): boolean {
  return s.length > 0 && [...s].every(isPunctuationChar)
}
