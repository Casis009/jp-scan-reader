import { useState, type ChangeEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { setPendingFile } from '../lib/pending'

type Source = 'camera' | 'gallery'

/**
 * 카메라 촬영(capture=environment)과 갤러리 선택 입력을 숨겨 두고,
 * render에 넘긴 open(source)로 연다. 고른 파일은 크롭 화면으로 넘어간다.
 */
export function ScanPicker({ render }: { render: (open: (source: Source) => void) => ReactNode }) {
  const [camera, setCamera] = useState<HTMLInputElement | null>(null)
  const [gallery, setGallery] = useState<HTMLInputElement | null>(null)
  const navigate = useNavigate()

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPendingFile(file)
    navigate('/scan')
  }

  const open = (source: Source) => (source === 'camera' ? camera : gallery)?.click()

  return (
    <>
      <input ref={setCamera} className="hidden-input" type="file" accept="image/*" capture="environment" onChange={onPick} />
      <input ref={setGallery} className="hidden-input" type="file" accept="image/*" onChange={onPick} />
      {render(open)}
    </>
  )
}
