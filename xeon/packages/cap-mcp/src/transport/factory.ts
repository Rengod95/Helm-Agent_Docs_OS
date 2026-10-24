import { err, ok, type Result, type Scheduler } from "@xeon/contracts";
import type { FetchLike } from "@modelcontextprotocol/client";
import type { TransportHandle } from "../adapter.ts";
import type { McpProcessPort } from "../ports/process.ts";
import type { McpHeaderSecrets } from "../ports/secrets.ts";
import type { ServerDefinition } from "../types.ts";
import { createHttpTransport } from "./http.ts";
import { createProcessStdioTransport } from "./process-stdio.ts";

// 서버 정의 → 전송. 레지스트리는 이 인터페이스만 안다. 시험은 인메모리 스텁 전송을 돌려주는 구현을 넣는다.

export interface OpenedTransport {
  readonly transport: TransportHandle;
  /** 서버 stderr 마지막 줄들(마스킹 전). 연결 실패의 `lastError.message`에 쓴다 */
  stderrTail(): readonly string[];
}

type OpenFailureCode =
  | "spawn_failed"
  | "secret_missing"
  | "secret_denied"
  | "unsupported"
  | "invalid_url";

export interface OpenFailure {
  readonly code: OpenFailureCode;
  readonly message: string;
}

export interface TransportFactory {
  open(
    server: ServerDefinition,
    signal: AbortSignal,
  ): Promise<Result<OpenedTransport, OpenFailure>>;
}

export interface DefaultTransportDeps {
  readonly process: McpProcessPort | undefined;
  readonly secrets: McpHeaderSecrets | undefined;
  readonly scheduler: Scheduler;
  readonly fetch: FetchLike | undefined;
  readonly stdioGraceMs: number;
}

const STDERR_TAIL_LINES = 20;

export function createTransportFactory(deps: DefaultTransportDeps): TransportFactory {
  return {
    async open(server, signal) {
      const transport = server.def.transport;
      if (transport.type === "stdio") {
        if (deps.process === undefined) {
          return err({ code: "unsupported", message: "no process port is connected" });
        }
        const spawned = await deps.process.spawn(
          {
            command: transport.command,
            args: transport.args ?? [],
            cwd: transport.cwd,
            secretEnv: transport.env ?? {},
            label: `mcp:${server.id}`,
            server: server.id,
          },
          signal,
        );
        if (!spawned.ok) {
          const failure = spawned.error;
          if (failure.kind === "spawn_failed") {
            return err({ code: "spawn_failed", message: `${failure.code}: ${failure.message}` });
          }
          return err({ code: failure.kind, message: `${failure.kind}: ${failure.ref}` });
        }
        const tail: string[] = [];
        const stdio = createProcessStdioTransport(spawned.value, {
          scheduler: deps.scheduler,
          graceMs: deps.stdioGraceMs,
          onStderrLine: (line) => {
            tail.push(line);
            if (tail.length > STDERR_TAIL_LINES) tail.shift();
          },
        });
        return ok({ transport: stdio, stderrTail: () => [...tail] });
      }
      if (!URL.canParse(transport.url)) {
        return err({ code: "invalid_url", message: "server url cannot be parsed" });
      }
      return ok({
        transport: createHttpTransport({
          server: server.id,
          kind: transport.type,
          url: transport.url,
          headerRefs: transport.headers ?? {},
          secrets: deps.secrets,
          fetch: deps.fetch,
        }),
        stderrTail: () => [],
      });
    },
  };
}
