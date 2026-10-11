import novel from '../../tests/fixtures/novel-vertical.json'
import jlpt from '../../tests/fixtures/jlpt-horizontal.json'

export interface DemoFixture {
  key: string
  label: string
  load: () => Promise<unknown>
}

const builtIn: DemoFixture[] = [
  { key: 'novel', label: '세로쓰기 소설', load: async () => novel },
  { key: 'jlpt', label: 'JLPT 문제', load: async () => jlpt },
]

// tests/fixtures/real/ 은 실제 책 결과라 저작권 때문에 커밋하지 않는다.
// 개발 서버에서만 목록에 넣고, 배포 빌드에는 들어가지 않는다.
const real: DemoFixture[] = import.meta.env.DEV
  ? Object.entries(import.meta.glob<{ default: unknown }>('../../tests/fixtures/real/*.json')).map(([path, load]) => ({
      key: path,
      label: path.split('/').pop()!.replace(/\.json$/, ''),
      load: async () => (await load()).default,
    }))
  : []

export const DEMO_FIXTURES: DemoFixture[] = [...builtIn, ...real]
