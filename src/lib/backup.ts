import { db, type AnalysisRecord } from './db'

const FORMAT = 'jp-scan-reader-backup'

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob()
}

// 원본 이미지 Blob은 data URL로 바꿔 넣는다. 썸네일은 이미 data URL 문자열이다.
type SerializedRecord = Omit<AnalysisRecord, 'image'> & { image: string }

/**
 * 전체 데이터를 JSON 문자열로 만든다. includeApiKey가 false면 API 키는 빼고 내보낸다.
 */
export async function exportBackup(includeApiKey: boolean): Promise<string> {
  const settings = (await db.settings.toArray()).filter((s) => includeApiKey || s.key !== 'apiKey')
  const records: SerializedRecord[] = await Promise.all(
    (await db.records.toArray()).map(async (r) => ({
      ...r,
      image: await blobToDataUrl(r.image),
    })),
  )
  const vocab = await db.vocab.toArray()
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), settings, records, vocab })
}

/** 기존 데이터를 모두 지우고 백업 내용으로 교체한다. */
export async function importBackup(json: string): Promise<{ records: number; vocab: number }> {
  const data = JSON.parse(json)
  if (data?.format !== FORMAT) throw new Error('이 앱의 백업 파일이 아닙니다.')
  const records: AnalysisRecord[] = await Promise.all(
    (data.records as SerializedRecord[]).map(async (r) => ({
      ...r,
      image: await dataUrlToBlob(r.image),
    })),
  )
  await db.transaction('rw', db.settings, db.records, db.vocab, async () => {
    const keepKey = await db.settings.get('apiKey')
    await Promise.all([db.settings.clear(), db.records.clear(), db.vocab.clear()])
    await db.settings.bulkPut(data.settings)
    // 백업에 키가 없으면 이 기기의 기존 키를 유지한다.
    if (keepKey && !data.settings.some((s: { key: string }) => s.key === 'apiKey')) await db.settings.put(keepKey)
    await db.records.bulkPut(records)
    await db.vocab.bulkPut(data.vocab)
  })
  return { records: records.length, vocab: data.vocab.length }
}

export function downloadText(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
