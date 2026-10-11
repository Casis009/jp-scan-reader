import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildUserMessage, SYSTEM_INSTRUCTION, USER_MESSAGE_TEMPLATE } from '../src/prompts/analysis'

const doc = readFileSync(new URL('../docs/analysis-prompt.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('src/prompts 상수가 docs/analysis-prompt.md와 같다', () => {
  it('시스템 지시문', () => {
    const section = doc.split('## 시스템 지시문\n\n')[1].split('\n\n---\n')[0]
    expect(SYSTEM_INSTRUCTION).toBe(section)
  })

  it('사용자 메시지', () => {
    const section = doc.split('## 사용자 메시지\n\n```\n')[1].split('\n```')[0]
    expect(USER_MESSAGE_TEMPLATE).toBe(section)
    expect(buildUserMessage('N3')).toBe('이 페이지를 분석해줘. 학습자 수준: N3')
  })
})
