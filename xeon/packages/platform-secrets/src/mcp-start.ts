import { createHash } from "node:crypto";
import type { SecretHandle } from "@xeon/contracts/capabilities";
import type { ApprovalEvidence, UseCtx } from "@xeon/contracts/services";

// L0.secrets.spec §4.3.1 (M3-REQ-58). 비밀 env를 쓰는 MCP stdio 서버의 기동 승인은 서버 정의 해시 단위로 한 번 받는다.
// 정의가 바뀌면 해시가 달라져 다시 받는다. 승인 UI와 승인 레코드(정의 해시 포함)는 L1·L2(M3-REQ-75, 97)가 맡고,
// 이 파일은 해시 계산, 기동용 사용 맥락, 해시에 묶인 증거 보관만 한다. 비밀 값은 이 파일을 지나지 않는다.

/** 기동 승인에 쓰는 `UseCtx.purpose` 접두. 메타 `use.tools`에 `mcp.start:*` 같은 패턴으로 허용한다 */
export const MCP_START_PURPOSE_PREFIX = "mcp.start:";

export interface McpStartDefinition {
  readonly serverId: string;
  /** 정의 출처(`settings:user`, `mcpjson:project`, `ext:<이름>` 등) */
  readonly source: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  /** 평문 env. 값은 정의의 일부이므로 해시에 들어간다(정의 파일에 이미 평문으로 있다) */
  readonly env: Readonly<Record<string, string>>;
  /** env 이름 → 비밀 핸들. 핸들(이름)만 해시에 들어가고 값은 알지 못한다 */
  readonly secretEnv: Readonly<Record<string, SecretHandle>>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * 서버 정의의 SHA-256 hex. 키 순서와 무관하다. `serverId`는 해시에 넣지 않는다(같은 정의를 다른 id로 옮겨도 새 승인을 받으려면
 * 승인 보관이 id를 함께 키로 쓴다). 비밀 env는 핸들만 들어 있어 비밀 값을 바꾸는 회전은 해시를 바꾸지 않는다.
 */
export function mcpDefinitionHash(def: McpStartDefinition): string {
  const text = canonical({
    source: def.source,
    command: def.command,
    args: def.args,
    cwd: def.cwd,
    env: def.env,
    secretEnv: def.secretEnv,
  });
  return createHash("sha256").update(text).digest("hex");
}

/** `withEnv`에 넘길 사용 맥락(mode 제외). 비밀 핸들마다 같은 맥락을 쓴다 */
export function mcpStartContext(
  def: McpStartDefinition,
  base: Pick<UseCtx, "actor" | "threadId" | "toolCallId" | "projectId">,
  approval: ApprovalEvidence | null,
): Omit<UseCtx, "mode"> {
  return {
    ...base,
    purpose: `${MCP_START_PURPOSE_PREFIX}${def.serverId}`,
    // 메타 use.commands에는 `mcp:<서버 id>` 패턴을 적는다
    target: { kind: "command", argv0: def.command, commandLine: `mcp:${def.serverId}` },
    approval,
  };
}

export interface McpStartApprovals {
  /** 사람이 이 정의를 승인했다. 이전에 같은 서버 id로 받은 승인은 대체된다 */
  record(def: McpStartDefinition, evidence: ApprovalEvidence): void;
  /** 지금 정의의 해시와 같은 정의에 대해 받은 승인만 돌려준다. 정의가 바뀌었거나 만료됐으면 null(다시 받아야 한다) */
  evidenceFor(def: McpStartDefinition): ApprovalEvidence | null;
  forget(serverId: string): void;
}

/** 프로세스 안에 정의 해시와 증거를 묶어 둔다. 영속 저장은 승인 레코드(L1)가 한다 */
export function createMcpStartApprovals(clock: { now(): number }): McpStartApprovals {
  const byServer = new Map<
    string,
    { readonly hash: string; readonly evidence: ApprovalEvidence }
  >();
  return {
    record(def, evidence) {
      byServer.set(def.serverId, { hash: mcpDefinitionHash(def), evidence });
    },
    evidenceFor(def) {
      const held = byServer.get(def.serverId);
      if (held === undefined || held.hash !== mcpDefinitionHash(def)) return null;
      const { expiresAt } = held.evidence;
      return expiresAt !== null && expiresAt <= clock.now() ? null : held.evidence;
    },
    forget(serverId) {
      byServer.delete(serverId);
    },
  };
}
