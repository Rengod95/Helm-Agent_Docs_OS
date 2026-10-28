import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/client";
import { attempt, detach } from "@xeon/contracts";
import type { StubServer } from "./stub-server.ts";

// 스텁 서버를 실제 표준 입출력 위에서 돌린다. 줄바꿈으로 나뉜 JSON-RPC를 stdin에서 읽어 `stub.reply`로 답하고 stdout에 쓴다.
// 실제 자식 프로세스로 띄우는 시험 스크립트(`bun fixtures/<서버>.ts`)가 쓴다. stdin이 닫히면 이행한다.

export interface StdioStreams {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
}

export function serveStubOverStdio(stub: StubServer, streams: StdioStreams): Promise<void> {
  const buffer = new ReadBuffer();
  const { promise, resolve } = Promise.withResolvers<void>();
  let inflight = 0;
  let ended = false;
  const maybeDone = (): void => {
    if (ended && inflight === 0) resolve();
  };
  streams.stdin.on("data", (chunk: string | Uint8Array) => {
    buffer.append(Buffer.from(chunk));
    for (;;) {
      const read = attempt(() => buffer.readMessage());
      if (!read.ok || read.value === null) return;
      const message = read.value;
      inflight += 1;
      const handled = stub
        .reply(message)
        .then((reply) => {
          if (reply !== undefined) streams.stdout.write(serializeMessage(reply));
          return true;
        })
        .finally(() => {
          inflight -= 1;
          maybeDone();
        });
      detach(handled, (cause) => {
        process.stderr.write(
          `stub failure: ${cause instanceof Error ? cause.message : "unknown"}\n`,
        );
      });
    }
  });
  streams.stdin.on("end", () => {
    ended = true;
    maybeDone();
  });
  return promise;
}
