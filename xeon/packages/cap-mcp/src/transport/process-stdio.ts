import { ReadBuffer, serializeMessage, type JSONRPCMessage } from "@modelcontextprotocol/client";
import { attempt, detach, type Scheduler } from "@xeon/contracts";
import type { TransportHandle } from "../adapter.ts";
import type { McpChild } from "../ports/process.ts";

// SDK `Transport`를 `xeon.process`로 띄운 자식 프로세스의 표준 입출력 위에 올린다(L2.mcp.spec §4.3).
// 줄바꿈으로 나뉜 JSON-RPC 메시지(MCP stdio 규약)를 SDK의 ReadBuffer·serializeMessage로 읽고 쓴다.
// 프로세스 생성과 종료 정책(SIGTERM 뒤 유예, 그다음 SIGKILL)은 이 파일이 아니라 포트와 `close()`가 맡는다.

export interface StdioTransportDeps {
  readonly scheduler: Scheduler;
  /** SIGTERM 뒤, SIGKILL 전 유예(ms). pi mcp 1.3.0 기본 2초 */
  readonly graceMs: number;
  /** 서버 stderr 한 줄. 마스킹은 받는 쪽이 한다 */
  readonly onStderrLine: (line: string) => void;
}

function bytesOf(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
}

function wait(
  exited: Promise<unknown>,
  ms: number,
  scheduler: Scheduler,
): Promise<"exited" | "timeout"> {
  return new Promise((resolve) => {
    const handle = scheduler.setTimeout(() => resolve("timeout"), ms);
    detach(
      exited.then(() => {
        scheduler.clearTimeout(handle);
        resolve("exited");
        return true;
      }),
      () => resolve("exited"),
    );
  });
}

export function createProcessStdioTransport(
  child: McpChild,
  deps: StdioTransportDeps,
): TransportHandle {
  const buffer = new ReadBuffer();
  let started = false;
  let closed = false;
  let stderrPending = "";

  const transport: TransportHandle = {
    start() {
      if (started) return Promise.reject(new Error("stdio transport already started"));
      started = true;
      child.stdout.on("data", (chunk: string | Uint8Array) => {
        buffer.append(Buffer.from(bytesOf(chunk)));
        for (;;) {
          const read = attempt(() => buffer.readMessage());
          if (!read.ok) {
            transport.onerror?.(
              new Error("invalid JSON-RPC line from server", { cause: read.error.cause }),
            );
            return;
          }
          if (read.value === null) return;
          transport.onmessage?.(read.value);
        }
      });
      child.stdout.on("error", (cause: Error) => transport.onerror?.(cause));
      child.stdin.on("error", (cause: Error) => transport.onerror?.(cause));
      child.stderr.on("data", (chunk: string | Uint8Array) => {
        stderrPending += new TextDecoder().decode(bytesOf(chunk));
        const lines = stderrPending.split("\n");
        stderrPending = lines.pop() ?? "";
        for (const line of lines) if (line.length > 0) deps.onStderrLine(line);
      });
      detach(
        child.exited.then(() => {
          if (stderrPending.length > 0) deps.onStderrLine(stderrPending);
          stderrPending = "";
          closed = true;
          transport.onclose?.();
          return true;
        }),
        (cause) => transport.onerror?.(new Error("process exit watcher failed", { cause })),
      );
      return Promise.resolve();
    },
    send(message: JSONRPCMessage): Promise<void> {
      if (closed) return Promise.reject(new Error("stdio transport is closed"));
      return new Promise((resolve, reject) => {
        child.stdin.write(serializeMessage(message), (cause?: Error | null) => {
          if (cause) reject(cause);
          else resolve();
        });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      child.stdin.end();
      if ((await wait(child.exited, deps.graceMs, deps.scheduler)) === "exited") return;
      child.kill("SIGTERM");
      if ((await wait(child.exited, deps.graceMs, deps.scheduler)) === "exited") return;
      child.kill("SIGKILL");
      await child.exited;
    },
  };
  return transport;
}
