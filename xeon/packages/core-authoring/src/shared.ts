// scaffold와 members가 함께 쓰는 두 검사. 쓰는 경로는 대상 폴더 안의 상대 경로만 받고(spec §3.3), 값은 좁혀서 쓴다.

/** 대상 폴더 기준 상대 경로인가. 절대 경로, 역슬래시, 빈 조각, `.`, `..`은 거절한다 */
export function isSafeRelative(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
