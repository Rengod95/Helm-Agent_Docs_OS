import type { Result } from "@fresnel/contracts";

// L2.web.spec §4.10.4a. 로컬 브라우저 엔진(Stagehand 4.3.0, 로컬 Chrome)을 cap-web이 아는 최소 모양으로 줄인 포트.
// cap-web은 @browserbasehq/stagehand를 import하지 않는다. 실제 어댑터는 조립 쪽(apps/host)이 이 포트에 맞춘다.
// 예상 가능한 실패는 `EngineError`를 `Result`로 돌려준다. 값은 문자열, 숫자, 평평한 객체뿐이다.

/** 엔진 수준 실패. 엔진이 없거나 연결이 끊긴 것(`unavailable`), 호출 취소(`aborted`), 동작이 실패한 것(`failed`)이다 */
export type EngineError =
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "aborted" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * 스냅샷 한 번. `formattedTree`의 줄은 들여쓰기가 깊이이고 `[frame-node] 역할[: 이름]` 꼴이다.
 * 예: `  [0-11] button: Pay now`. frame-node id가 `xpathMap`과 `urlMap`의 키다.
 */
export interface EngineSnapshot {
  readonly url: string;
  readonly title: string;
  readonly formattedTree: string;
  /** frame-node id → XPath (예: `0-11` → `/html[1]/body[1]/button[1]`) */
  readonly xpathMap: Readonly<Record<string, string>>;
  /** frame-node id → 링크 주소. 링크 요소만 있다 */
  readonly urlMap: Readonly<Record<string, string>>;
}

export interface EngineScreenshot {
  readonly mediaType: string;
  /** base64 */
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

export interface EngineOpenOptions {
  readonly headless: boolean;
  readonly profile: "ephemeral" | `named:${string}`;
  /** 필터 프록시 주소. 프록시를 띄우지 않는 조립에서는 없다 */
  readonly proxy?: { readonly server: string };
}

export interface BrowserEnginePort {
  /** 엔진이 설치되어 쓸 수 있는가 */
  available(
    signal: AbortSignal,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly detail: string }>;
  open(
    options: EngineOpenOptions,
    signal: AbortSignal,
  ): Promise<Result<EngineSession, EngineError>>;
}

/** 열린 엔진 세션 하나. XPath는 마지막 스냅샷의 `xpathMap`에서 온 값이다 */
export interface EngineSession {
  goto(url: string, signal: AbortSignal): Promise<Result<void, EngineError>>;
  snapshot(signal: AbortSignal): Promise<Result<EngineSnapshot, EngineError>>;
  click(xpath: string, signal: AbortSignal): Promise<Result<void, EngineError>>;
  fill(xpath: string, text: string, signal: AbortSignal): Promise<Result<void, EngineError>>;
  /** 초점이 있는 요소에 글자를 친다 */
  typeText(text: string, signal: AbortSignal): Promise<Result<void, EngineError>>;
  pressKey(key: string, signal: AbortSignal): Promise<Result<void, EngineError>>;
  /** 픽셀 단위 이동 */
  scroll(deltaX: number, deltaY: number, signal: AbortSignal): Promise<Result<void, EngineError>>;
  selectOption(
    xpath: string,
    values: readonly string[],
    signal: AbortSignal,
  ): Promise<Result<void, EngineError>>;
  waitMs(ms: number, signal: AbortSignal): Promise<Result<void, EngineError>>;
  screenshot(signal: AbortSignal): Promise<Result<EngineScreenshot, EngineError>>;
  /** XPath를 주면 그 요소의 글자, 없으면 페이지 본문 */
  readText(xpath: string | undefined, signal: AbortSignal): Promise<Result<string, EngineError>>;
  /** 요소가 속한 폼의 action 주소. 폼이 없으면 `undefined` */
  formAction(xpath: string, signal: AbortSignal): Promise<Result<string | undefined, EngineError>>;
  /** 마지막으로 부른 뒤 일어난 최상위 문서 이동 주소를 돌려주고 비운다 */
  navigations(): readonly string[];
  close(signal: AbortSignal): Promise<Result<void, EngineError>>;
}
