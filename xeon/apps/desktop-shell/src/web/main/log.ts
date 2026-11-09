// 운영 로거(`Logger` 계약): 한 줄에 JSON 객체 하나를 쓴다(`ts`, `level`, `event`, 필드). 표준 출력은 제어 프로토콜이라 여기로 쓰지 않는다.
// 이름이 토큰, 쿠키, 인증, 시크릿, 비밀번호처럼 보이는 필드는 값을 `[redacted]`로 바꾼다(중첩된 값도 같다).
// 페어링 코드와 토큰 원문은 호출자가 이 로거에 넘기지 않는다(auth-port.ts는 값을 싣지 않는다). 이 검사는 마지막 방어선이다.
import type { LogFields, LogValue, Logger } from "@fresnel/contracts";

const SECRET_KEY: RegExp =
  /token|cookie|authorization|secret|password|passphrase|private|credential/iu;
const REDACTED = "[redacted]";

function isLogArray(value: LogValue): value is readonly LogValue[] {
  return Array.isArray(value);
}

function isLogObject(value: LogValue): value is LogFields {
  return typeof value === "object" && value !== null && !isLogArray(value);
}

function scrub(value: LogValue, key: string): LogValue {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (isLogArray(value)) return value.map((item) => scrub(item, key));
  if (isLogObject(value)) return scrubFields(value);
  return value;
}

/** 필드 묶음의 비밀처럼 보이는 값을 가린다. 원래 객체는 바꾸지 않는다 */
function scrubFields(fields: LogFields): LogFields {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = scrub(value, key);
  return out;
}

export interface StderrLoggerOptions {
  readonly write: (line: string) => void;
  readonly now: () => number;
  /** 모든 줄에 붙는 고정 필드 */
  readonly base?: LogFields;
}

export function createStderrLogger(options: StderrLoggerOptions): Logger {
  const base: LogFields = options.base ?? {};
  function emit(
    level: "debug" | "info" | "warn" | "error",
    event: string,
    fields?: LogFields,
  ): void {
    const line = {
      ts: new Date(options.now()).toISOString(),
      level,
      event,
      ...base,
      ...scrubFields(fields ?? {}),
    };
    options.write(`${JSON.stringify(line)}\n`);
  }
  return {
    debug: (event, fields) => {
      emit("debug", event, fields);
    },
    info: (event, fields) => {
      emit("info", event, fields);
    },
    warn: (event, fields) => {
      emit("warn", event, fields);
    },
    error: (event, fields) => {
      emit("error", event, fields);
    },
    child: (fields) =>
      createStderrLogger({ write: options.write, now: options.now, base: { ...base, ...fields } }),
  };
}
