import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// 엔진 로그 줄을 받는 늦은 연결 싱크. L0.os가 시작되기 전에는 로그 파일 위치(OsDirs.state)를 모르므로 줄을 모아 두었다가
// attach 때 파일에 쓴다. stdio 호스트의 stdout에는 계약 메시지 외의 바이트를 쓰지 않는다(HS-33).

const MAX_BUFFERED_LINES = 1000;

export interface LateLogSink {
  readonly sink: (line: string) => void;
  /** 파일 경로를 정하고 모은 줄을 쓴다. 파일을 열 수 없으면 줄을 버린다(로그가 시작을 막지 않는다) */
  attach(path: string): void;
}

export function createLateLogSink(): LateLogSink {
  const state: { path: string | undefined; buffered: string[]; broken: boolean } = {
    path: undefined,
    buffered: [],
    broken: false,
  };

  function write(path: string, line: string): void {
    try {
      appendFileSync(path, `${line}\n`, { mode: 0o600 });
    } catch {
      state.broken = true;
    }
  }

  return {
    sink(line) {
      if (state.broken) return;
      if (state.path === undefined) {
        if (state.buffered.length < MAX_BUFFERED_LINES) state.buffered.push(line);
        return;
      }
      write(state.path, line);
    },
    attach(path) {
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      } catch {
        state.broken = true;
        state.buffered = [];
        return;
      }
      state.path = path;
      for (const line of state.buffered.splice(0)) write(path, line);
    },
  };
}
