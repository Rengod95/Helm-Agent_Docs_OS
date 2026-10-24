/** 서버 id와 도구 이름은 ASCII로 제한되므로 코드 단위 비교는 UTF-8 바이트 순과 같다(F.capabilities.spec §4.5) */
export function byteOrder(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
