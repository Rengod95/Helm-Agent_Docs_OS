import { Bug, err, ok, type Result } from "@fresnel/contracts";
import type { ToolName } from "@fresnel/contracts/capabilities";
import type {
  RegistrationId,
  ToolRegisterError,
  ToolReplaceClaim,
} from "@fresnel/contracts/extensions";
import {
  TOOL_RISK_ORDER,
  type ToolReplacementState,
  type ToolReplacementStatus,
  type ToolRisk,
} from "@fresnel/contracts/services";
import type { ToolEntry } from "./types.ts";

// L1.tools.spec §3.3 등록 표. 같은 이름이 이미 있으면 등록은 통째로 실패하고 표는 그대로다(name_conflict). 확장 조합이 낼 수 있는 정상 운영 중의 실패라 값으로 돌려준다(TY-24).
// 내장 도구를 같은 이름으로 대체하는 등록(§4.13)은 이 표에 들어가지 않고 후보로 따로 둔다. 후보는 사용자가 승인해 `active`가 되어야 같은 이름을 가로챈다.

/** 대체 후보 하나. 원본과 이름이 같고 `effective`가 위험 등급 하한을 적용한 항목이다 */
interface Candidate {
  readonly name: ToolName;
  readonly owner: RegistrationId;
  readonly claim: ToolReplaceClaim;
  /** 확장이 낸 항목. 위험 등급은 선언 그대로다 */
  readonly declared: ToolEntry;
  /** 하한을 적용한 항목. 표에서 원본 대신 쓰는 것 */
  readonly effective: ToolEntry;
  readonly originalRisk: ToolRisk;
  status: ToolReplacementStatus;
  approvalId: string | null;
}

export interface ToolRegistry {
  /** 등록한다. 돌려주는 함수가 이 호출로 넣은 항목을 뺀다. 이름이 겹치면 아무것도 넣지 않고 err */
  add(entries: readonly ToolEntry[]): Result<() => void, ToolRegisterError>;
  /**
   * 내장 도구를 같은 이름으로 대체하는 후보를 둔다. 상태는 `pending`이고 `activate` 전에는 표가 바뀌지 않는다.
   * 대상이 내장 기능 도구가 아니거나 다른 확장이 이미 대체하면 err. 돌려주는 함수가 후보를 뺀다(원본이 다시 보인다)
   */
  addReplacement(
    owner: RegistrationId,
    entry: ToolEntry,
    claim: ToolReplaceClaim,
  ): Result<() => void, ToolRegisterError>;
  /** 승인 상태를 바꾼다. 모르는 후보면 false */
  setReplacement(
    owner: RegistrationId,
    name: ToolName,
    change: { readonly status: ToolReplacementStatus; readonly approvalId: string | null },
  ): boolean;
  replacements(): readonly ToolReplacementState[];
  /** 승인 전이고 아직 승인 요청을 올리지 않은 후보 */
  unrequested(): readonly ToolReplacementState[];
  get(name: ToolName): ToolEntry | undefined;
  all(): readonly ToolEntry[];
  /** 내장 도구를 처음에 한 번 넣는다. 이름이 겹치면 코드 결함이다(Bug) */
  seed(entries: readonly ToolEntry[]): void;
}

/** 두 위험 등급 중 높은 쪽 */
function riskFloor(first: ToolRisk, second: ToolRisk): ToolRisk {
  return TOOL_RISK_ORDER.indexOf(first) >= TOOL_RISK_ORDER.indexOf(second) ? first : second;
}

/** 대체할 수 없는 항목인 사유. 대체할 수 있으면 undefined */
function forbiddenReason(
  original: ToolEntry | undefined,
): Extract<ToolRegisterError, { kind: "replace_forbidden" }>["reason"] | undefined {
  if (original === undefined) return "no_target";
  // `core.*` 순서 키는 core-tools·core-agents가 직접 등록한 도구 실행 틀 도구(tool_search, read_tool_output, spawn 등)다
  if (original.ref.capability.startsWith("core.")) return "core_pipeline";
  // 내장 기능 도구만 대체한다. MCP 서버 도구와 확장 도구는 기능이 없다
  if (original.capability === undefined || original.mcpServer !== undefined) return "not_builtin";
  return undefined;
}

function stateOf(candidate: Candidate): ToolReplacementState {
  return {
    toolName: candidate.name,
    owner: candidate.owner,
    extension: candidate.claim.extension,
    trust: candidate.claim.trust,
    status: candidate.status,
    approvalId: candidate.approvalId,
    originalRisk: candidate.originalRisk,
    effectiveRisk: candidate.effective.risk,
  };
}

export function createRegistry(): ToolRegistry {
  const table = new Map<ToolName, ToolEntry>();
  const candidates: Candidate[] = [];

  /** 원본이 표에 있고 후보가 승인됐을 때만 대체 항목이 원본 자리를 차지한다 */
  function effective(entry: ToolEntry): ToolEntry {
    const active = candidates.find(
      (candidate) => candidate.status === "active" && candidate.name === entry.name,
    );
    return active === undefined ? entry : active.effective;
  }

  return {
    add(entries) {
      const incoming = new Set<string>();
      for (const entry of entries) {
        if (table.has(entry.name) || incoming.has(entry.name)) {
          return err({ kind: "name_conflict", toolName: entry.name });
        }
        incoming.add(entry.name);
      }
      for (const entry of entries) table.set(entry.name, entry);
      let removed = false;
      return ok(() => {
        if (removed) return;
        removed = true;
        for (const entry of entries) {
          // 같은 이름이 다른 등록으로 바뀌어 있으면 그 항목은 건드리지 않는다
          if (table.get(entry.name) === entry) table.delete(entry.name);
        }
      });
    },
    addReplacement(owner, entry, claim) {
      const original = table.get(entry.name);
      const reason = forbiddenReason(original);
      if (original === undefined || reason !== undefined) {
        return err({
          kind: "replace_forbidden",
          toolName: entry.name,
          reason: reason ?? "no_target",
        });
      }
      const existing = candidates.find((candidate) => candidate.name === entry.name);
      if (existing !== undefined) {
        return err({
          kind: "replace_conflict",
          toolName: entry.name,
          existing: existing.claim.extension,
        });
      }
      const candidate: Candidate = {
        name: entry.name,
        owner,
        claim,
        declared: entry,
        // 위험 등급은 원본보다 낮추지 않고 원본의 classes를 물려받는다(F.capabilities.spec §10). capability는 원본의 것이 아니므로 비운다
        effective: {
          ...entry,
          replacesBuiltin: true,
          risk: riskFloor(entry.risk, original.risk),
          classes: [...new Set([...original.classes, ...entry.classes])],
        },
        originalRisk: original.risk,
        status: "pending",
        approvalId: null,
      };
      candidates.push(candidate);
      let removed = false;
      return ok(() => {
        if (removed) return;
        removed = true;
        const at = candidates.indexOf(candidate);
        if (at >= 0) candidates.splice(at, 1);
      });
    },
    setReplacement(owner, name, change) {
      const candidate = candidates.find((item) => item.owner === owner && item.name === name);
      if (candidate === undefined) return false;
      candidate.status = change.status;
      candidate.approvalId = change.approvalId;
      return true;
    },
    replacements: () => candidates.map(stateOf),
    unrequested: () =>
      candidates
        .filter((candidate) => candidate.status === "pending" && candidate.approvalId === null)
        .map(stateOf),
    seed(entries) {
      for (const entry of entries) {
        if (table.has(entry.name)) throw new Bug(`tools.builtin_conflict: ${entry.name}`);
        table.set(entry.name, entry);
      }
    },
    get(name) {
      const entry = table.get(name);
      return entry === undefined ? undefined : effective(entry);
    },
    all: () => [...table.values()].map(effective),
  };
}
