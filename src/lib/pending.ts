/** 촬영한 파일을 크롭 화면으로 넘기기 위한 메모리 보관소. 새로고침하면 사라져도 된다. */
let pendingFile: File | null = null

export function setPendingFile(file: File | null) {
  pendingFile = file
}

export function getPendingFile(): File | null {
  return pendingFile
}
