import { detach, type Clock, type Logger } from "@xeon/contracts";
import { parseSecretRef, type SecretHandle } from "@xeon/contracts/capabilities";
import type { JsonValue, ThreadId } from "@xeon/contracts/conversation";
import { requestKeyFor } from "@xeon/contracts/records";
import type {
  ApprovalEvidence,
  ApprovalRequestInput,
  ApprovalService,
  UseCtx,
} from "@xeon/contracts/services";
import type { SecretChecker } from "./secret-gate.ts";
import { sha256HexSync } from "./util.ts";

// L1.tools.spec §4.12.1 (M3-05, M3-REQ-75). 비밀 env를 쓰는 stdio MCP 서버의 기동 승인. 승인은 서버 정의 해시마다 한 번이고
// 정의가 바뀌면 해시가 달라져 다시 묻는다. 승인 요청(kind `tool`)의 본문에 정의 해시를 싣는다(`argsHash`와 `args.definitionHash`).
// 서버는 도구 호출이 아니라 연결 때 뜨므로 이 승인은 호출 안이 아닌 대화(`threadId`)에 묶인 비차단 요청이다.
// 승인 UI는 L4, 증거를 받아 쓰는 일은 L2.mcp와 L0.process가 한다. 값은 이 파일에 오지 않는다.

/** 기동 승인 본문의 도구 이름과 규칙 id */
export const MCP_START_TOOL_NAME = "mcp_start";
export const MCP_START_RULE_ID = "mcp.start";
/** 기동 승인에 쓰는 `UseCtx.purpose` 접두. `platform-secrets`의 `MCP_START_PURPOSE_PREFIX`와 같은 값이다 */
const PURPOSE_PREFIX = "mcp.start:";
const TITLE_MAX = 120;

/** 기동 승인 대상 정의. 비밀 값은 없고 참조만 있다 */
export interface McpStartDefinition {
  readonly server: string;
  /** 정의 출처(`settings:user`, `mcpjson:project`, `ext:<이름>` 등) */
  readonly source: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly env: Readonly<Record<string, string>>;
  /** env 이름 → `secret://` 참조 */
  readonly secretEnv: Readonly<Record<string, string>>;
}

export type McpStartVerdict =
  | { readonly kind: "approved"; readonly evidence: ApprovalEvidence }
  /** 승인을 기다린다. 응답이 오면 `onResolved`가 서버 id를 알린다 */
  | { readonly kind: "pending" }
  | { readonly kind: "denied"; readonly reason: string };

export interface McpStartGate {
  /** `threadId`가 없으면 승인 요청을 올릴 곳이 없어 `pending`이다(대화가 생긴 뒤 다시 부른다) */
  check(
    definition: McpStartDefinition,
    context: { readonly threadId: ThreadId | undefined },
  ): Promise<McpStartVerdict>;
  /** 승인이나 거부가 기록되면 서버 id로 알린다. 돌려주는 함수가 구독을 푼다 */
  onResolved(listener: (server: string) => void): () => void;
  dispose(): void;
}

export interface McpStartGateDeps {
  readonly approvals: Pick<ApprovalService, "open" | "wait">;
  readonly secrets: SecretChecker | undefined;
  /** 정의 해시(SHA-256 hex). 키 순서와 무관하고 비밀 값이 들어가지 않는다. L0 `mcpDefinitionHash`를 조립 루트가 넘긴다 */
  readonly hash: (definition: McpStartDefinition) => string;
  readonly clock: Clock;
  readonly logger: Logger | undefined;
}

function handlesOf(secretEnv: Readonly<Record<string, string>>): SecretHandle[] | undefined {
  const handles: SecretHandle[] = [];
  for (const ref of Object.values(secretEnv)) {
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) return undefined;
    if (!handles.includes(parsed.value.handle)) handles.push(parsed.value.handle);
  }
  return handles;
}

function titleOf(server: string, handles: readonly SecretHandle[]): string {
  const head = `Start MCP server "${server}" with `;
  const full = `${head}${handles.join(", ")}?`;
  if (full.length <= TITLE_MAX) return full;
  return `${head}${String(handles.length)} secrets?`.slice(0, TITLE_MAX);
}

/** 승인 요청 본문. 정의 해시가 `argsHash`와 `args.definitionHash`에 실린다(M3-REQ-75) */
function mcpStartApprovalInput(
  definition: McpStartDefinition,
  definitionHash: string,
  handles: readonly SecretHandle[],
): Omit<ApprovalRequestInput, "origin"> & { readonly requestKey: string } {
  const args: Record<string, JsonValue> = {
    server: definition.server,
    source: definition.source,
    command: definition.command,
    args: [...definition.args],
    cwd: definition.cwd,
    envNames: Object.keys(definition.env).toSorted(),
    secretEnv: { ...definition.secretEnv },
    definitionHash,
  };
  return {
    requestKey: requestKeyFor(
      `mcpstart:${definition.server}:${definitionHash.slice(0, 24)}`,
      sha256HexSync,
    ),
    title: titleOf(definition.server, handles),
    body: {
      kind: "tool",
      tool: {
        toolName: MCP_START_TOOL_NAME,
        risk: "exec",
        args,
        argsHash: definitionHash,
        ruleId: MCP_START_RULE_ID,
      },
    },
    remember: ["once"],
  };
}

interface Held {
  readonly hash: string;
  readonly evidence: ApprovalEvidence;
}

export function createMcpStartGate(deps: McpStartGateDeps): McpStartGate {
  /** 서버 id → 마지막으로 승인받은 정의 해시와 증거. 정의가 바뀌면 해시가 달라 맞지 않는다 */
  const held = new Map<string, Held>();
  const listeners = new Set<(server: string) => void>();
  /** 응답을 기다리는 승인 id */
  const waiting = new Set<string>();
  const stop = new AbortController();

  function evidenceFor(server: string, hash: string): ApprovalEvidence | null {
    const entry = held.get(server);
    if (entry === undefined || entry.hash !== hash) return null;
    const { expiresAt } = entry.evidence;
    return expiresAt !== null && expiresAt <= deps.clock.now() ? null : entry.evidence;
  }

  function notify(server: string): void {
    for (const listener of listeners) listener(server);
  }

  function watch(server: string, hash: string, approvalId: string): void {
    if (waiting.has(approvalId)) return;
    waiting.add(approvalId);
    detach(
      deps.approvals.wait(approvalId, stop.signal).then((waited) => {
        waiting.delete(approvalId);
        if (!waited.ok) return false;
        if (waited.value.decision === "allow") {
          held.set(server, {
            hash,
            evidence: {
              approvalId: waited.value.approvalId,
              scope: "per-session",
              grantedAt: deps.clock.now(),
              expiresAt: null,
            },
          });
        }
        notify(server);
        return true;
      }),
      (cause) => {
        waiting.delete(approvalId);
        deps.logger?.warn("tools.mcp_start_wait_failed", {
          server,
          message: cause instanceof Error ? cause.name : "unknown",
        });
      },
    );
  }

  async function policyVerdict(
    definition: McpStartDefinition,
    handles: readonly SecretHandle[],
  ): Promise<string | undefined> {
    if (deps.secrets === undefined) return "the secrets service is not available";
    const ctx: UseCtx = {
      mode: "env",
      purpose: `${PURPOSE_PREFIX}${definition.server}`,
      target: {
        kind: "command",
        argv0: definition.command,
        commandLine: `mcp:${definition.server}`,
      },
      actor: "runtime",
      threadId: null,
      toolCallId: null,
      projectId: null,
      approval: null,
    };
    for (const handle of handles) {
      // eslint-disable-next-line no-await-in-loop -- 앞 비밀이 거부면 뒤는 묻지 않는다
      const checked = await deps.secrets.check(handle, ctx);
      if (!checked.ok) return `${handle}: ${checked.error.kind}`;
      if (checked.value.kind === "deny") return `${handle}: ${checked.value.reason}`;
    }
    return undefined;
  }

  return {
    async check(definition, context) {
      const hash = deps.hash(definition);
      const cached = evidenceFor(definition.server, hash);
      if (cached !== null) return { kind: "approved", evidence: cached };
      const handles = handlesOf(definition.secretEnv);
      if (handles === undefined)
        return { kind: "denied", reason: "secretEnv has a value that is not a secret reference" };
      const refused = await policyVerdict(definition, handles);
      if (refused !== undefined) return { kind: "denied", reason: refused };
      if (context.threadId === undefined) return { kind: "pending" };
      const input = mcpStartApprovalInput(definition, hash, handles);
      const opened = await deps.approvals.open({
        ...input,
        origin: {
          threadId: context.threadId,
          turnId: null,
          stepId: null,
          toolCallId: null,
          caller: "host",
        },
      });
      if (!opened.ok) return { kind: "denied", reason: "the start approval could not be recorded" };
      const { request, resolution } = opened.value;
      if (resolution === null) {
        watch(definition.server, hash, request.approvalId);
        return { kind: "pending" };
      }
      if (resolution.decision !== "allow") {
        return { kind: "denied", reason: "the user denied starting this server definition" };
      }
      const evidence: ApprovalEvidence = {
        approvalId: resolution.approvalId,
        scope: "per-session",
        grantedAt: deps.clock.now(),
        expiresAt: null,
      };
      held.set(definition.server, { hash, evidence });
      return { kind: "approved", evidence };
    },
    onResolved(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      stop.abort();
      listeners.clear();
    },
  };
}
