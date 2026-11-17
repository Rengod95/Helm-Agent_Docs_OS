import type { CommandIo } from "./host-command.ts";

// 이 프로세스의 표준 입출력을 `CommandIo`로 만든다. 가볍게 유지한다: 플러그인 호스트 진입이 엔진을 싣지 않고 이 파일을 쓴다.
// 쓰기는 조각마다 flush한다. 엔진이 줄을 기다리므로 버퍼에 남으면 안 된다.

function fileSinkStream(sink: {
  write(chunk: Uint8Array): unknown;
  flush(): unknown;
}): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      sink.write(chunk);
      await sink.flush();
    },
  });
}

export function bunCommandIo(): CommandIo {
  return {
    stdin: Bun.stdin.stream(),
    stdout: fileSinkStream(Bun.stdout.writer()),
    stderr: fileSinkStream(Bun.stderr.writer()),
  };
}
