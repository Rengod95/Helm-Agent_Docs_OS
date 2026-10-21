import type { LogFields, LogLevel, Logger } from "@xeon/contracts";

export interface LogRecord {
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
}

export interface RecordingLogger {
  readonly logger: Logger;
  readonly records: readonly LogRecord[];
}

/** 호출을 모아 두는 로거. 시험이 경고와 오류 로그를 확인한다 */
export function recordingLogger(): RecordingLogger {
  const records: LogRecord[] = [];
  function make(base: LogFields): Logger {
    const write =
      (level: LogLevel) =>
      (event: string, fields?: LogFields): void => {
        records.push({ level, event, fields: { ...base, ...fields } });
      };
    return {
      debug: write("debug"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      child: (fields) => make({ ...base, ...fields }),
    };
  }
  return { logger: make({}), records };
}
