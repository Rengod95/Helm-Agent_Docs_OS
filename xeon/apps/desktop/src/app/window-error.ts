// 창의 `error` 이벤트를 로그 값으로 바꾼다. 던져진 값이 Error가 아니면(브라우저가 직접 낸 이벤트) 이름이 "unknown"뿐이라 원인을 알 수 없었다
// (AGE-77 F-39: 이어서 실행 뒤 5초에 40번 이상). 그래서 이름 대신 브라우저가 준 문장, 파일, 줄을 함께 남긴다.
// ResizeObserver의 "undelivered notifications"는 브라우저가 한 프레임에 크기 알림을 다 못 돌렸다는 무해한 알림이라 오류로 세지 않는다.

/** 로그에 남기는 문장의 최대 글자 수 */
const MESSAGE_MAX = 200;

/** `window.addEventListener("error")`가 주는 값 중 읽는 부분 */
export interface WindowErrorEvent {
  readonly error: unknown;
  readonly message: string;
  readonly filename: string;
  readonly lineno: number;
}

export interface WindowErrorLog {
  readonly name: string;
  readonly message: string;
  readonly source: string;
  readonly line: number;
}

const RESIZE_OBSERVER_BENIGN =
  /^ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/u;

/** 무해한 브라우저 알림이면 null, 아니면 로그 값 */
export function windowErrorLogOf(event: WindowErrorEvent): WindowErrorLog | null {
  if (event.error === null && RESIZE_OBSERVER_BENIGN.test(event.message)) return null;
  return {
    name: event.error instanceof Error ? event.error.name : "unknown",
    message: event.message.slice(0, MESSAGE_MAX),
    source: event.filename.slice(-MESSAGE_MAX),
    line: event.lineno,
  };
}
