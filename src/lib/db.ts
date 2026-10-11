import Dexie, { type EntityTable } from 'dexie'

export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
export type FuriganaMode = 'all' | 'level' | 'none'
/** 모델마다 지원 수준이 다르다(lib/models.ts). gemini-3.8-flash는 MINIMAL 미지원. */
export type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'

export interface Settings {
  apiKey: string
  model: string
  level: JlptLevel
  furiganaMode: FuriganaMode
  thinkingLevel: ThinkingLevel
  demoMode: boolean
  /** 결과 화면 하단에 소요 시간·토큰 수 표시 */
  showStats: boolean
}

export const DEFAULT_MODEL = 'gemini-3.8-flash'

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  level: 'N3',
  furiganaMode: 'level',
  thinkingLevel: 'LOW',
  demoMode: false,
  showStats: true,
}

/** 분석 기록. analysis는 3단계에서 zod 타입으로 좁힌다. */
export interface AnalysisRecord {
  id?: number
  hash: string
  createdAt: number
  model: string
  image: Blob
  thumbnail: Blob
  firstSentence: string
  analysis: unknown
}

export interface VocabEntry {
  id?: number
  lemma: string
  reading: string
  meaning: string
  pos: string
  jlpt: JlptLevel | null
  sentence: string
  recordId: number | null
  createdAt: number
}

interface SettingRow {
  key: keyof Settings
  value: Settings[keyof Settings]
}

export class AppDB extends Dexie {
  settings!: EntityTable<SettingRow, 'key'>
  records!: EntityTable<AnalysisRecord, 'id'>
  vocab!: EntityTable<VocabEntry, 'id'>

  constructor() {
    super('jp-scan-reader')
    this.version(1).stores({
      settings: 'key',
      records: '++id, &hash, createdAt',
      vocab: '++id, lemma, jlpt, createdAt, recordId',
    })
  }
}

export const db = new AppDB()
