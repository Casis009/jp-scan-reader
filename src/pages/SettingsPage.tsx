import { useState } from 'react'
import { DEFAULT_MODEL, type FuriganaMode, type JlptLevel, type Settings, type ThinkingLevel } from '../lib/db'
import { saveSetting, useSettings } from '../lib/settings'
import { downloadText, exportBackup, importBackup } from '../lib/backup'
import { effectiveThinkingLevel, MODEL_PRESETS, thinkingLevelsFor } from '../lib/models'

const LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const FURIGANA_MODES: { value: FuriganaMode; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'level', label: '내 수준 이상' },
  { value: 'none', label: '숨김' },
]
const THINKING_LABEL: Record<ThinkingLevel, string> = { MINIMAL: '최소', LOW: '낮음', MEDIUM: '보통', HIGH: '높음' }
const CUSTOM = '__custom__'

export default function SettingsPage() {
  const settings = useSettings()
  // 복원 후에는 입력란 초안을 새 값으로 다시 채우도록 폼을 다시 만든다.
  const [restored, setRestored] = useState<{ generation: number; message: string }>({ generation: 0, message: '' })
  if (!settings) return <main className="page" />
  return (
    <SettingsForm
      key={restored.generation}
      settings={settings}
      initialMessage={restored.message}
      onRestored={(message) => setRestored((r) => ({ generation: r.generation + 1, message }))}
    />
  )
}

interface FormProps {
  settings: Settings
  initialMessage: string
  onRestored: (message: string) => void
}

function SettingsForm({ settings, initialMessage, onRestored }: FormProps) {
  const [keyDraft, setKeyDraft] = useState(settings.apiKey)
  const [modelDraft, setModelDraft] = useState(settings.model)
  const [customModel, setCustomModel] = useState(() => !MODEL_PRESETS.some((m) => m.id === settings.model))
  const thinkingLevels = thinkingLevelsFor(settings.model)
  const effectiveThinking = effectiveThinkingLevel(settings.model, settings.thinkingLevel)
  const [showKey, setShowKey] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    initialMessage ? { kind: 'ok', text: initialMessage } : null,
  )
  const [busy, setBusy] = useState(false)
  const [includeKey, setIncludeKey] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<File | null>(null)
  const [restoreInput, setRestoreInput] = useState<HTMLInputElement | null>(null)

  const keyDirty = keyDraft.trim() !== settings.apiKey
  const modelDirty = modelDraft.trim() !== settings.model

  const saveKey = async () => {
    await saveSetting('apiKey', keyDraft.trim())
    setStatus({ kind: 'ok', text: keyDraft.trim() ? 'API 키를 저장했습니다.' : 'API 키를 지웠습니다.' })
  }

  const saveModel = async (value: string) => {
    const model = value.trim() || DEFAULT_MODEL
    setModelDraft(model)
    await saveSetting('model', model)
    setStatus({ kind: 'ok', text: `모델을 ${model}(으)로 저장했습니다.` })
  }

  // 모델 정보 조회는 생성 한도를 쓰지 않으면서 키와 모델 이름을 함께 확인할 수 있다.
  const testKey = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { GoogleGenAI } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey: keyDraft.trim() })
      const info = await ai.models.get({ model: modelDraft.trim() || DEFAULT_MODEL })
      setStatus({ kind: 'ok', text: `연결 확인: ${info.displayName ?? info.name}` })
    } catch (e) {
      setStatus({ kind: 'error', text: `확인 실패: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const doExport = async () => {
    setBusy(true)
    try {
      const json = await exportBackup(includeKey)
      const date = new Date().toISOString().slice(0, 10)
      downloadText(`jp-scan-reader-${date}.json`, json, 'application/json')
      setStatus({ kind: 'ok', text: '백업 파일을 내보냈습니다.' })
    } catch (e) {
      setStatus({ kind: 'error', text: `백업 실패: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async () => {
    if (!pendingRestore) return
    setBusy(true)
    try {
      const { records, vocab } = await importBackup(await pendingRestore.text())
      onRestored(`복원 완료: 기록 ${records}개, 단어 ${vocab}개`)
    } catch (e) {
      setStatus({ kind: 'error', text: `복원 실패: ${e instanceof Error ? e.message : String(e)}` })
      setPendingRestore(null)
      setBusy(false)
    }
  }

  return (
    <main className="page stack">
      <h1>설정</h1>

      <section className="card stack">
        <div className="field">
          <label htmlFor="apiKey">Gemini API 키</label>
          <div className="row">
            <input
              id="apiKey"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="AIza..."
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <button className="btn" onClick={() => setShowKey(!showKey)} aria-label="키 보기 전환">
              {showKey ? '숨김' : '보기'}
            </button>
          </div>
        </div>
        <p className="notice">키는 이 기기에만 저장됩니다. 무료 티어에서는 입력한 내용이 모델 개선에 쓰일 수 있습니다.</p>
        <div className="row">
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={!keyDirty} onClick={saveKey}>
            키 저장
          </button>
          <button className="btn" style={{ flex: 1 }} disabled={!keyDraft.trim() || busy} onClick={testKey}>
            연결 확인
          </button>
        </div>
      </section>

      <section className="card stack">
        <div className="field">
          <label htmlFor="model">모델</label>
          <select
            id="model"
            value={customModel ? CUSTOM : settings.model}
            onChange={(e) => {
              if (e.target.value === CUSTOM) setCustomModel(true)
              else {
                setCustomModel(false)
                saveModel(e.target.value)
              }
            }}
          >
            {MODEL_PRESETS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.id === DEFAULT_MODEL ? ' (기본)' : ''}
              </option>
            ))}
            <option value={CUSTOM}>직접 입력…</option>
          </select>
          {customModel && (
            <input
              aria-label="모델 이름 직접 입력"
              spellCheck={false}
              autoCapitalize="off"
              placeholder="gemini-…"
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={() => modelDirty && saveModel(modelDraft)}
            />
          )}
          <span className="dim small">목록은 2026-10-12 공식 문서 기준 무료 티어 모델입니다. 현재: {settings.model}</span>
        </div>
        <div className="field">
          <span className="label">생각 수준</span>
          <div className="segmented" role="group">
            {thinkingLevels.map((t) => (
              <button key={t} aria-pressed={effectiveThinking === t} onClick={() => saveSetting('thinkingLevel', t)}>
                {THINKING_LABEL[t]}
              </button>
            ))}
          </div>
          <span className="dim small">높을수록 판독·분석이 꼼꼼해지지만 느려지고 출력 한도를 더 씁니다. 모델마다 고를 수 있는 수준이 다릅니다.</span>
        </div>
        <label className="switch">
          <span className="small">결과 화면에 소요 시간·토큰 수 표시</span>
          <input type="checkbox" checked={settings.showStats} onChange={(e) => saveSetting('showStats', e.target.checked)} />
        </label>
      </section>

      <section className="card stack">
        <div className="field">
          <span className="label">학습자 수준</span>
          <div className="segmented" role="group">
            {LEVELS.map((lv) => (
              <button key={lv} aria-pressed={settings.level === lv} onClick={() => saveSetting('level', lv)}>
                {lv}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">후리가나 표시</span>
          <div className="segmented" role="group">
            {FURIGANA_MODES.map((m) => (
              <button key={m.value} aria-pressed={settings.furiganaMode === m.value} onClick={() => saveSetting('furiganaMode', m.value)}>
                {m.label}
              </button>
            ))}
          </div>
          <span className="dim small">'내 수준 이상'은 {settings.level}~N1 단어와 등급 외 단어에만 후리가나를 붙입니다.</span>
        </div>
        <label className="switch">
          <span>
            데모 모드
            <br />
            <span className="dim small">API를 호출하지 않고 예시 분석 결과를 사용합니다.</span>
          </span>
          <input type="checkbox" checked={settings.demoMode} onChange={(e) => saveSetting('demoMode', e.target.checked)} />
        </label>
      </section>

      <section className="card stack">
        <span className="label" style={{ fontWeight: 600 }}>데이터 백업 · 복원</span>
        <label className="switch">
          <span className="small">백업에 API 키 포함</span>
          <input type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} />
        </label>
        <button className="btn" disabled={busy} onClick={doExport}>
          JSON으로 내보내기
        </button>
        <input
          ref={setRestoreInput}
          className="hidden-input"
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            setPendingRestore(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
        {pendingRestore ? (
          <div className="stack">
            <p className="notice">현재 기록과 단어장을 모두 지우고 「{pendingRestore.name}」 내용으로 바꿉니다.</p>
            <div className="row">
              <button className="btn" style={{ flex: 1 }} onClick={() => setPendingRestore(null)}>
                취소
              </button>
              <button className="btn btn-danger" style={{ flex: 1 }} disabled={busy} onClick={doRestore}>
                복원 실행
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" disabled={busy} onClick={() => restoreInput?.click()}>
            JSON에서 복원
          </button>
        )}
      </section>

      {status && (
        <p role="status" className={status.kind === 'error' ? 'notice' : 'dim small'}>
          {status.text}
        </p>
      )}
    </main>
  )
}
