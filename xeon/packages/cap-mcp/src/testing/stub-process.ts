import { PassThrough } from "node:stream";
import { deserializeMessage, serializeMessage } from "@modelcontextprotocol/client";
import { detach, err, ok } from "@xeon/contracts";
import type { McpChild, McpProcessPort, McpSpawnError, McpSpawnSpec } from "../ports/process.ts";
import type { StubServer } from "./stub-server.ts";

// 스텁 서버를 자식 프로세스처럼 보이게 하는 가짜 `McpProcessPort`. 표준 입출력 위에서 줄바꿈 JSON-RPC를 말한다.
// stdio 전송과 레지스트리의 프로세스 경로 시험에 쓴다(실제 프로세스 없음).

export interface StubProcessPort {
  readonly port: McpProcessPort;
  /** 받은 spawn 요청들 */
  readonly spawned: readonly McpSpawnSpec[];
  /** 다음 spawn을 이 오류로 실패시킨다 */
  failNext(error: McpSpawnError): void;
  /** 가장 최근 자식이 갑자기 끝난 것처럼 만든다 */
  crash(): void;
  /** 가장 최근 자식의 stderr에 한 줄을 쓴다 */
  writeStderr(line: string): void;
  /** kill 신호 기록 */
  readonly signals: readonly string[];
}

interface LiveChild {
  readonly stderr: PassThrough;
  end(code: number | null, signal: string | null): void;
}

export interface StubProcessOptions {
  /** 무시하는 종료 신호. stdin 닫기와 SIGTERM을 무시하면 SIGKILL까지 가야 끝난다 */
  readonly ignore?: readonly ("stdin_end" | "SIGTERM")[];
}

export function createStubProcessPort(
  stub: StubServer,
  options: StubProcessOptions = {},
): StubProcessPort {
  const spawned: McpSpawnSpec[] = [];
  const signals: string[] = [];
  let failure: McpSpawnError | undefined;
  let latest: LiveChild | undefined;
  let pids = 1000;

  const port: McpProcessPort = {
    spawn(spec) {
      spawned.push(spec);
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        return Promise.resolve(err(error));
      }
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let ended = false;
      const { promise: exited, resolve: finish } = Promise.withResolvers<{
        code: number | null;
        signal: string | null;
      }>();
      const end = (code: number | null, signal: string | null): void => {
        if (ended) return;
        ended = true;
        stdout.end();
        stderr.end();
        finish({ code, signal });
      };
      let pending = "";
      const answer = async (line: string): Promise<void> => {
        const reply = await stub.reply(deserializeMessage(line));
        if (reply !== undefined && !ended) stdout.write(serializeMessage(reply));
      };
      stdin.on("data", (chunk: Buffer | string) => {
        pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          detach(answer(line), (cause) => {
            stderr.write(`stub failure: ${cause instanceof Error ? cause.message : "unknown"}\n`);
          });
        }
      });
      stdin.on("end", () => {
        if (options.ignore?.includes("stdin_end") !== true) end(0, null);
      });
      const child: McpChild = {
        pid: (pids += 1),
        stdin,
        stdout,
        stderr,
        exited,
        kill(signal) {
          signals.push(signal);
          if (signal === "SIGTERM" && options.ignore?.includes("SIGTERM") === true) return;
          end(null, signal);
        },
      };
      latest = { stderr, end };
      return Promise.resolve(ok(child));
    },
  };

  return {
    port,
    spawned,
    signals,
    failNext(error) {
      failure = error;
    },
    crash() {
      latest?.end(1, null);
    },
    writeStderr(line) {
      latest?.stderr.write(`${line}\n`);
    },
  };
}
