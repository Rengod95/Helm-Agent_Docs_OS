import type { LogFields, Logger } from "@xeon/contracts";

export interface LogLine {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields;
}

/** 줄을 모아 두는 Logger 대역 */
export function memoryLogger(lines: LogLine[] = [], base: LogFields = {}): Logger {
  const push =
    (level: LogLine["level"]) =>
    (event: string, fields: LogFields = {}): void => {
      lines.push({ level, event, fields: { ...base, ...fields } });
    };
  return {
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
    child: (fields) => memoryLogger(lines, { ...base, ...fields }),
  };
}
