// 기록하는 로거: 로그에 비밀이 없는지 시험이 확인한다.
import type { LogFields, Logger } from "@fresnel/contracts";

export interface LogEntry {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields;
}

export interface RecordingLogger extends Logger {
  readonly entries: LogEntry[];
}

export function recordingLogger(entries: LogEntry[] = []): RecordingLogger {
  function at(level: LogEntry["level"]): (event: string, fields?: LogFields) => void {
    return (event, fields) => {
      entries.push({ level, event, fields: fields ?? {} });
    };
  }
  return {
    entries,
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: () => recordingLogger(entries),
  };
}
