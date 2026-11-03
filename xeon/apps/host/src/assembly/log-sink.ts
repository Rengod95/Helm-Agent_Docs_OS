import { basename, dirname } from "node:path";
import { createRotatingFileSink, type LogSink } from "@fresnel/platform-os";

// 엔진 로그 줄을 받는 늦은 연결 싱크. L0.os가 시작되기 전에는 로그 파일 위치(OsDirs.state)를 모르므로 줄을 모아 두었다가
// attach 때 파일에 쓴다. 파일은 L0.os의 회전 싱크(`createRotatingFileSink`)가 쓴다: 크기 상한을 넘으면 `<이름>.1`로 옮긴다.
// stdio 호스트의 stdout에는 계약 메시지 외의 바이트를 쓰지 않는다(HS-33).

const MAX_BUFFERED_LINES = 1000;

/** 로그 파일 한 개의 상한(바이트). 설정 카탈로그에 회전 키가 없어 상수다. L0.os.spec §3.5의 10 MiB와 다르다 */
export const LOG_FILE_MAX_BYTES: number = 5 * 1024 * 1024;
/** 보관하는 로그 파일 수(현재 파일 포함). 설정 키가 없어 상수다. platform-os의 기본 5개와 다르다 */
const LOG_FILE_MAX_FILES: number = 3;

export interface LateLogSink {
  readonly sink: (line: string) => void;
  /**
   * 파일 경로를 정하고 모은 줄을 쓴다. 디렉터리를 만들지 못하거나 쓰지 못하면 그 줄만 버리고 다음 줄에 다시 쓴다
   * (로그가 시작을 막지 않고, 디스크가 비거나 폴더가 다시 생기면 이어서 남는다. L0.os.spec의 줄 단위 실패)
   */
  attach(path: string): void;
}

export function createLateLogSink(): LateLogSink {
  const state: { file: LogSink | undefined; buffered: string[] } = {
    file: undefined,
    buffered: [],
  };

  function emit(line: string): void {
    if (state.file === undefined) {
      if (state.buffered.length < MAX_BUFFERED_LINES) state.buffered.push(line);
      return;
    }
    state.file(line);
  }

  return {
    sink: emit,
    attach(path) {
      // 디렉터리(0700)를 만들고 파일(0600)에 덧붙이고 회전하는 일은 회전 싱크가 한다. 쓰지 못한 줄은 싱크가 버린다
      const file = createRotatingFileSink({
        dir: dirname(path),
        fileName: basename(path),
        maxBytes: LOG_FILE_MAX_BYTES,
        maxFiles: LOG_FILE_MAX_FILES,
      });
      state.file = file;
      for (const line of state.buffered.splice(0)) emit(line);
    },
  };
}
