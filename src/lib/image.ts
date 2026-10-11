/** 크롭 작업용 이미지의 긴 변 상한. 최종 출력(2000px)보다 크게 잡아 잘라낸 부분의 화질을 지킨다. */
const WORK_MAX = 4096
export const OUTPUT_MAX = 2000
export const OUTPUT_QUALITY = 0.85

/** 0~1 비율로 나타낸 잘라낼 영역 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.')
  return [c, ctx]
}

/** EXIF 회전값을 반영해 읽고, 긴 변을 WORK_MAX 이하로 줄인 캔버스를 만든다. */
export async function loadOriented(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, WORK_MAX / Math.max(bitmap.width, bitmap.height))
  const [c, ctx] = canvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  ctx.drawImage(bitmap, 0, 0, c.width, c.height)
  bitmap.close()
  return c
}

/** 90도 단위 회전. clockwise=false면 반시계 방향. */
export function rotate90(src: HTMLCanvasElement, clockwise: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(src.height, src.width)
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate(((clockwise ? 1 : -1) * Math.PI) / 2)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

export function toBlob(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))), 'image/jpeg', quality),
  )
}

/** 영역을 잘라 긴 변 OUTPUT_MAX 이하(확대는 하지 않음), JPEG OUTPUT_QUALITY로 만든다. */
export async function cropAndResize(src: HTMLCanvasElement, rect: CropRect): Promise<{ blob: Blob; width: number; height: number }> {
  const sx = Math.round(rect.x * src.width)
  const sy = Math.round(rect.y * src.height)
  const sw = Math.max(1, Math.round(rect.width * src.width))
  const sh = Math.max(1, Math.round(rect.height * src.height))
  const scale = Math.min(1, OUTPUT_MAX / Math.max(sw, sh))
  const [c, ctx] = canvas(Math.round(sw * scale), Math.round(sh * scale))
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return { blob: await toBlob(c, OUTPUT_QUALITY), width: c.width, height: c.height }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 목록용 썸네일. 긴 변 240px JPEG data URL. */
export async function makeThumbnail(blob: Blob, maxSide = 240): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const [c, ctx] = canvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
  ctx.drawImage(bitmap, 0, 0, c.width, c.height)
  bitmap.close()
  return c.toDataURL('image/jpeg', 0.7)
}
