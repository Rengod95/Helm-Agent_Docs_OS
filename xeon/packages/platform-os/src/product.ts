/**
 * 제품 이름에 묶인 값을 모은 한 곳(L0.os.spec §3.12, M3-REQ-54). 앱 디렉터리 이름, 설정 파일 이름, 사용자 대행 UA,
 * 알림 앱 이름, 임시·런타임 디렉터리 접두가 여기서만 나온다. M3 값은 `xeon`이고 M4 전에 이 파일만 바꾼다.
 */
export const PRODUCT = {
  /** 소문자 식별 이름. 앱 디렉터리, 임시 디렉터리 접두에 쓴다 */
  name: "xeon",
  /** 사람에게 보이는 이름. 알림 앱 이름에 쓴다 */
  displayName: "Xeon",
  /** 사용자 설정 파일 이름 */
  settingsFileName: "settings.json",
} as const;

/** 사용자 대행(HTTP User-Agent) 문자열. 버전은 호출자가 넘긴다 */
export function productUserAgent(version: string): string {
  return `${PRODUCT.name}/${version}`;
}

/** `<tmp>/<name>-<uid>` 꼴 디렉터리 이름 */
export function productUidDirName(uid: number): string {
  return `${PRODUCT.name}-${String(uid)}`;
}
