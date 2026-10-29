import { err, ok, type Result, type Scheduler } from "@xeon/contracts";
import type { FetchLike } from "@modelcontextprotocol/client";
import type { TransportHandle } from "../adapter.ts";
import type { McpProcessPort } from "../ports/process.ts";
import type { McpStartEvidence, McpStartGate } from "../ports/start-gate.ts";
import { splitEnv } from "../servers/values.ts";
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
  | "approval_required"
  | "invalid_url";

export interface OpenFailure {
  readonly code: OpenFailureCode;
  readonly message: string;
}

/** 연결 시도마다 레지스트리가 정해 넘기는 맥락 */
interface OpenContext {
  /** stdio 서버를 샌드박스에 넣는가(`sandboxOf`) */
  readonly sandbox: boolean;
  /** 기동 승인을 올릴 대화. 아직 대화가 없으면 undefined */
  readonly threadId: string | undefined;
}

export interface TransportFactory {
  open(
    server: ServerDefinition,
    signal: AbortSignal,
    context?: OpenContext,
  ): Promise<Result<OpenedTransport, OpenFailure>>;
}

export interface DefaultTransportDeps {
  readonly process: McpProcessPort | undefined;
  readonly secrets: McpHeaderSecrets | undefined;
  readonly scheduler: Scheduler;
  readonly fetch: FetchLike | undefined;
  readonly stdioGraceMs: number;
  /** 비밀 env stdio 서버의 기동 승인. 없으면 비밀 env 서버는 승인 증거 없이 띄우려다 `secret_denied`가 된다 */
  readonly startGate?: McpStartGate | undefined;
}

const STDERR_TAIL_LINES = 20;

export function createTransportFactory(deps: DefaultTransportDeps): TransportFactory {
  return {
    async open(server, signal, context) {
      const transport = server.def.transport;
      if (transport.type === "stdio") {
        if (deps.process === undefined) {
          return err({ code: "unsupported", message: "no process port is connected" });
        }
        const { plain, secret } = splitEnv(transport.env);
        let approval: McpStartEvidence | null = null;
        if (Object.keys(secret).length > 0 && deps.startGate !== undefined) {
          const verdict = await deps.startGate.check(
            {
              server: server.id,
              source: server.source,
              command: transport.command,
              args: transport.args ?? [],
              cwd: transport.cwd ?? null,
              env: plain,
              secretEnv: secret,
            },
            { threadId: context?.threadId },
          );
          if (verdict.kind === "pending") {
            return err({
              code: "approval_required",
              message: "waiting for the user to approve starting this server definition",
            });
          }
          if (verdict.kind === "denied") {
            return err({ code: "secret_denied", message: verdict.reason });
          }
          approval = verdict.evidence;
        }
        const spawned = await deps.process.spawn(
          {
            command: transport.command,
            args: transport.args ?? [],
            cwd: transport.cwd,
            env: plain,
            secretEnv: secret,
            approval,
            sandbox: context?.sandbox ?? false,
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
