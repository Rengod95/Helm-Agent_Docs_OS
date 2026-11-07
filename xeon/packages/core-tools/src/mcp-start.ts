import { canonicalJson, detach, type Clock, type Logger } from "@fresnel/contracts";
import { parseSecretRef, type SecretHandle } from "@fresnel/contracts/capabilities";
import type { JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import { requestKeyFor } from "@fresnel/contracts/records";
import type {
  ApprovalEvidence,
  ApprovalRequestInput,
  ApprovalService,
  UseCtx,
} from "@fresnel/contracts/services";
import type { SecretChecker } from "./secret-gate.ts";
import { sha256HexSync } from "./util.ts";

// L1.tools.spec §4.12.1 (M3-05, M3-REQ-75). 시크릿 env를 쓰는 stdio MCP 서버의 기동 승인. 승인은 서버 정의 해시마다 한 번이고
// 정의가 바뀌면 해시가 달라져 다시 묻는다. 승인 요청(kind `tool`)의 본문에 정의 해시를 싣는다(`argsHash`와 `args.definitionHash`).
// 서버는 도구 호출이 아니라 연결 때 뜨므로 이 승인은 호출 안이 아닌 대화(`threadId`)에 묶인 비차단 요청이다.
// 승인 UI는 L4, 증거를 받아 쓰는 일은 L2.mcp와 L0.process가 한다. 값은 이 파일에 오지 않는다.
// 직전에 허용된 정의와 해시가 다르면 승인 본문 `args.changed`에 바뀐 필드와 이전 명령을 싣는다(처음 묻는 정의에는 없다).

/** 기동 승인 본문의 도구 이름과 규칙 id */
export const MCP_START_TOOL_NAME = "mcp_start";
export const MCP_START_RULE_ID = "mcp.start";
/** 기동 승인에 쓰는 `UseCtx.purpose` 접두. `platform-secrets`의 `MCP_START_PURPOSE_PREFIX`와 같은 값이다 */
const PURPOSE_PREFIX = "mcp.start:";
const TITLE_MAX = 120;

/** 승인 본문 `changed.fields`가 가리키는 정의 필드. 순서가 `fields`의 순서다 */
const CHANGED_FIELDS = ["command", "args", "cwd", "source", "env", "secretEnv"] as const;
type McpStartChangedField = (typeof CHANGED_FIELDS)[number];

/** 기동 승인 대상 정의. 시크릿 값은 없고 참조만 있다 */
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
  /** 정의 해시(SHA-256 hex). 키 순서와 무관하고 시크릿 값이 들어가지 않는다. L0 `mcpDefinitionHash`를 조립 루트가 넘긴다 */
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

function titleOf(server: string, handles: readonly SecretHandle[], command: string): string {
  // 시크릿 없이 프로젝트 출처라서 묻는 정의는 실행할 명령을 제목에 보인다
  if (handles.length === 0) return `Run MCP server "${server}" (${command})?`.slice(0, TITLE_MAX);
  const head = `Start MCP server "${server}" with `;
  const full = `${head}${handles.join(", ")}?`;
  if (full.length <= TITLE_MAX) return full;
  return `${head}${String(handles.length)} secrets?`.slice(0, TITLE_MAX);
}

/** 허용된 정의의 요약. 바뀐 곳을 찾는 데만 쓴다. env 값은 복사하지 않고 다이제스트로만 비교한다 */
interface DefinitionSummary {
  readonly source: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly envDigest: string;
  readonly secretEnv: Readonly<Record<string, string>>;
}

function summaryOf(definition: McpStartDefinition): DefinitionSummary {
  return {
    source: definition.source,
    command: definition.command,
    args: [...definition.args],
    cwd: definition.cwd,
    envDigest: sha256HexSync(canonicalJson(definition.env)),
    secretEnv: { ...definition.secretEnv },
  };
}

/** 두 요약에서 다른 필드를 `CHANGED_FIELDS` 순서로 돌려준다. `secretEnv`는 이름과 참조 전체를 본다(참조만 바뀌어도 잡는다) */
function changedFieldsOf(
  before: DefinitionSummary,
  after: DefinitionSummary,
): McpStartChangedField[] {
  const differs: Readonly<Record<McpStartChangedField, boolean>> = {
    command: before.command !== after.command,
    args: canonicalJson(before.args) !== canonicalJson(after.args),
    cwd: before.cwd !== after.cwd,
    source: before.source !== after.source,
    env: before.envDigest !== after.envDigest,
    secretEnv: canonicalJson(before.secretEnv) !== canonicalJson(after.secretEnv),
  };
  return CHANGED_FIELDS.filter((field) => differs[field]);
}

/** 승인 본문 `args.changed`: 바뀐 필드와 이전 정의의 명령, 인자, 실행 폴더. JSON 값만 싣고 env 값은 싣지 않는다 */
function changedArgOf(before: DefinitionSummary, after: DefinitionSummary): JsonValue {
  return {
    fields: changedFieldsOf(before, after),
    before: { command: before.command, args: [...before.args], cwd: before.cwd },
  };
}

/** 승인 요청 본문. 정의 해시가 `argsHash`와 `args.definitionHash`에 실린다(M3-REQ-75). `changed`는 바뀐 정의일 때만 있다 */
function mcpStartApprovalInput(
  definition: McpStartDefinition,
  definitionHash: string,
  handles: readonly SecretHandle[],
  changed: JsonValue | null,
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
  // 처음 묻는 정의에는 `changed` 키가 없다
  if (changed !== null) args["changed"] = changed;
  return {
    requestKey: requestKeyFor(
      `mcpstart:${definition.server}:${definitionHash.slice(0, 24)}`,
      sha256HexSync,
    ),
    title: titleOf(definition.server, handles, definition.command),
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
  /** 허용된 정의의 요약. 다음 정의가 바뀌었을 때 `changed`를 만든다 */
  readonly summary: DefinitionSummary;
}

export function createMcpStartGate(deps: McpStartGateDeps): McpStartGate {
  /** 서버 id → 마지막으로 승인받은 정의 해시, 증거, 요약. 정의가 바뀌면 해시가 달라 맞지 않는다. 프로세스 안에만 둔다 */
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

  function watch(
    server: string,
    hash: string,
    summary: DefinitionSummary,
    approvalId: string,
  ): void {
    if (waiting.has(approvalId)) return;
    waiting.add(approvalId);
    detach(
      deps.approvals.wait(approvalId, stop.signal).then((waited) => {
        waiting.delete(approvalId);
        if (!waited.ok) return false;
        if (waited.value.decision === "allow") {
          held.set(server, {
            hash,
            summary,
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
    // 시크릿이 없는 정의(프로젝트 출처 명령)는 시크릿 정책을 거치지 않는다
    if (handles.length === 0) return undefined;
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
      // eslint-disable-next-line no-await-in-loop -- 앞 시크릿이 거부면 뒤는 묻지 않는다
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
      const summary = summaryOf(definition);
      // 허용된 정의가 있고 해시가 다르면 바뀐 정의다. 그때만 `changed`를 싣는다
      const previous = held.get(definition.server);
      const changed =
        previous === undefined || previous.hash === hash
          ? null
          : changedArgOf(previous.summary, summary);
      const input = mcpStartApprovalInput(definition, hash, handles, changed);
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
        watch(definition.server, hash, summary, request.approvalId);
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
      held.set(definition.server, { hash, evidence, summary });
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
