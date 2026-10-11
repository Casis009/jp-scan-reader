import Dexie, { type EntityTable } from 'dexie'
import type { Analysis } from '../prompts/schema'
import type { Stats } from './gemini'

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

/** 분석 기록. 같은 hash(전송 이미지의 SHA-256)가 있으면 API를 부르지 않고 이 기록을 쓴다. */
export interface AnalysisRecord {
  id?: number
  /** 데모 결과는 실제 결과와 섞이지 않게 "demo:<fixture>:" 접두어를 붙인다(lib/records.ts) */
  hash: string
  createdAt: number
  /** 분석한 모델 이름, 데모면 데모 이름 */
  model: string
  /** 데모로 만든 기록이면 fixture 키 */
  demoKey?: string
  image: Blob
  /** 목록용 작은 JPEG data URL */
  thumbnail: string
  firstSentence: string
  /** 앱 내부 형식(기본값을 채운 것) */
  analysis: Analysis
  stats?: Stats
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
