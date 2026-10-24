import type { LogFields, Logger, LogLevel } from "@xeon/contracts";

// WebView Logger. 고정 이벤트 이름과 필드만 받는다(내용은 호출하는 쪽이 넣지 않는다, L4.desktop.design 11.2).
// 셸 앱 로그 파일로 보내는 명령(desktop_log_write)은 L4.desktop.spec 3.3 명령 표에 아직 없다(design 14절 3번).
// 그 전까지는 메모리 링과 개발자 도구 콘솔(warn 이상)에만 남는다.

export type LogLine = {
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
};

export interface LogRing {
  readonly logger: Logger;
  lines(): readonly LogLine[];
}

export function createWebViewLogger(
  capacity: number,
  sink: (line: LogLine) => void = consoleSink,
): LogRing {
  const ring: LogLine[] = [];
  const make = (base: LogFields): Logger => {
    const write = (level: LogLevel, event: string, fields?: LogFields): void => {
      const line: LogLine = { level, event, fields: { ...base, ...fields } };
      ring.push(line);
      if (ring.length > capacity) ring.shift();
      if (level === "warn" || level === "error") sink(line);
    };
    return {
      debug: (event, fields) => write("debug", event, fields),
      info: (event, fields) => write("info", event, fields),
      warn: (event, fields) => write("warn", event, fields),
      error: (event, fields) => write("error", event, fields),
      child: (fields) => make({ ...base, ...fields }),
    };
  };
  return { logger: make({}), lines: () => [...ring] };
}

function consoleSink(line: LogLine): void {
  const text = `${line.event} ${JSON.stringify(line.fields)}`;
  // oxlint-disable-next-line no-console -- WebView 로그 싱크: 앱 로그 파일 명령이 생기기 전의 개발자 도구 출력 (L4.desktop.design 11.2, 14절 3번)
  if (line.level === "error") console.error(text);
  // oxlint-disable-next-line no-console -- WebView 로그 싱크: 앱 로그 파일 명령이 생기기 전의 개발자 도구 출력 (L4.desktop.design 11.2, 14절 3번)
  else console.warn(text);
}
