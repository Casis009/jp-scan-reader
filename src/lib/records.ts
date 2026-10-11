import { db, type AnalysisRecord } from './db'
import type { DemoFixture } from './demo'
import type { Stats } from './gemini'
import { makeThumbnail, sha256Hex } from './image'
import type { Analysis } from '../prompts/schema'

/**
 * 캐시 키. 전송할 이미지의 SHA-256이다.
 * 데모 결과가 같은 사진의 실제 결과 자리를 차지하지 않도록 데모는 접두어를 붙인다.
 */
export async function cacheKey(image: Blob, demo?: DemoFixture): Promise<string> {
  const sha = await sha256Hex(image)
  return demo ? `demo:${demo.key}:${sha}` : sha
}

export function findRecordByHash(hash: string): Promise<AnalysisRecord | undefined> {
  return db.records.where('hash').equals(hash).first()
}

/** 목록에 보일 첫 문장. 본문 문장을 우선한다. */
export function firstSentenceOf(analysis: Analysis): string {
  const s = analysis.sentences.find((x) => x.kind === 'body') ?? analysis.sentences[0]
  return s?.text ?? ''
}

interface SaveInput {
  hash: string
  image: Blob
  analysis: Analysis
  stats?: Stats
  model: string
  demoKey?: string
}

/** 기록을 저장한다. 같은 hash가 있으면(다시 분석) 그 기록을 새 결과로 덮어쓴다. id를 돌려준다. */
export async function saveRecord({ hash, image, analysis, stats, model, demoKey }: SaveInput): Promise<number> {
  const record: AnalysisRecord = {
    hash,
    createdAt: Date.now(),
    model,
    demoKey,
    image,
    thumbnail: await makeThumbnail(image),
    firstSentence: firstSentenceOf(analysis),
    analysis,
    stats,
  }
  const existing = await findRecordByHash(hash)
  if (existing?.id !== undefined) {
    await db.records.put({ ...record, id: existing.id })
    return existing.id
  }
  return db.records.add(record) as Promise<number>
}

export function deleteRecord(id: number) {
  return db.records.delete(id)
}
