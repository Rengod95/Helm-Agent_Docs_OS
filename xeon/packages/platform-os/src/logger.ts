import { attempt, type Clock, type LogFields, type Logger, type LogLevel } from "@xeon/contracts";

/**
 * 마스킹 함수. 조립 루트가 platform-secrets의 마스킹 기능을 이 자리에 연결한다. platform-os는 platform-secrets를
 * import하지 않는다. 연결 예(apps/host, xeon.secrets가 먼저 등록된 뒤):
 *
 *     logRedact: (line) => secretService.redactor.mask(line).text
 *
 * 마스킹 서비스가 아직 없는 조립(M0 테스트 등)은 `(line) => line`을 명시적으로 넘긴다. 이 인자는 필수다.
 */
export type LogRedact = (line: string) => string;
/** 한 줄을 받아 내보낸다. 운영 기본은 L4가 넘기는 stderr 쓰기 함수 */
export type LogSink = (line: string) => void;

/**
 * 로그 수준. 값이면 `setLevel`로만 바뀐다. 함수면 로그를 낼 때마다 불러 그 값을 쓴다(설정 `l0.os.log.level`의 live 변경이
 * 구독 없이 다음 호출부터 반영된다). `setLevel`을 부르면 그 값으로 고정한다.
 */
export type LogLevelSource = LogLevel | (() => LogLevel);

export interface JsonLinesLoggerOptions {
  readonly clock: Clock;
  readonly sink: LogSink;
  readonly level: LogLevelSource;
  /** 없으면 조립 실패. 무동작이 필요하면 명시적으로 identity를 넘긴다 */
  readonly redact: LogRedact;
  readonly baseFields?: LogFields;
}

export type LevelControlledLogger = Logger & { setLevel(level: LogLevel): void };

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

/** redact가 던지면 원문 줄을 버리고 이 한 줄만 쓴다(원문이 새지 않게) */
const REDACT_FAILED_LINE = '{"event":"log.redact_failed"}';
const SERIALIZE_FAILED_LINE = '{"event":"log.serialize_failed"}';

interface LoggerState {
  level: () => LogLevel;
}

function levelReader(source: LogLevelSource): () => LogLevel {
  return typeof source === "function" ? source : () => source;
}

/**
 * JSON Lines 로거. 한 줄에 JSON 객체 하나이고 필드는 ts, level, event, baseFields, child 필드, 호출 필드 순서로
 * 합친다(같은 키는 뒤가 이긴다). 레벨 미만 호출은 직렬화하지 않는다. 직렬화한 줄 전체를 redact에 넘긴 뒤 sink로 보낸다.
 */
export function createJsonLinesLogger(opts: JsonLinesLoggerOptions): LevelControlledLogger {
  return makeLogger(opts, { level: levelReader(opts.level) }, opts.baseFields ?? {});
}

function makeLogger(
  opts: JsonLinesLoggerOptions,
  state: LoggerState,
  fixed: LogFields,
): LevelControlledLogger {
  const emit = (level: LogLevel, event: string, fields: LogFields | undefined): void => {
    if (LEVEL_RANK[level] < LEVEL_RANK[state.level()]) return;
    // 실패한 원인(cause)에는 필드 값이 들어 있을 수 있어 싣지 않는다. 고정 줄이 실패를 알린다
    const line = attempt(() =>
      JSON.stringify({ ts: opts.clock.now(), level, event, ...fixed, ...fields }),
    );
    if (!line.ok) {
      opts.sink(SERIALIZE_FAILED_LINE);
      return;
    }
    const masked = attempt(() => opts.redact(line.value));
    if (!masked.ok) {
      opts.sink(REDACT_FAILED_LINE);
      return;
    }
    opts.sink(masked.value);
  };
  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (fields) => makeLogger(opts, state, { ...fixed, ...fields }),
    setLevel: (level) => {
      state.level = () => level;
    },
  };
}
