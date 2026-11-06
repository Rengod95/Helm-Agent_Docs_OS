// IPC 발신 프레임 검사. 최상위 프레임이고 우리 UI 출처일 때만 명령이 닿는다(fresnel-view:// 프레임은 닿지 못한다).

export interface FrameInfo {
  readonly url: string;
  /** 최상위 프레임이면 true */
  readonly isMain: boolean;
}

export const UI_SCHEME = "app:";
export const UI_HOST = "localhost";

/** 사용자 정의 스킴의 `URL.origin`은 "null"이라 스킴과 호스트로 비교한다 */
export function isUiUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === UI_SCHEME && url.hostname === UI_HOST;
}

export function isTrustedFrame(frame: FrameInfo | null): boolean {
  return frame !== null && frame.isMain && isUiUrl(frame.url);
}
