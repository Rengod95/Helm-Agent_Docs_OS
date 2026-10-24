export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogValue =
  | string
  | number
  | boolean
  | null
  | readonly LogValue[]
  | { readonly [k: string]: LogValue };

export type LogFields = { readonly [k: string]: LogValue };

/** 구조화 로거. 운영 구현은 L0 platform-os, event는 고정 이름이다. */
export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** 고정 필드를 더한 자식 로거 */
  child(fields: LogFields): Logger;
}
