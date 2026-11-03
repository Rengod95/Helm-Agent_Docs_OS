import { detach, type Logger } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { requestKeyFor } from "@fresnel/contracts/records";
import {
  TOOL_REPLACE_APPROVAL_TOOL,
  TOOL_REPLACE_RULE_ID,
  type ApprovalRequestInput,
  type ApprovalService,
  type ToolReplacementState,
} from "@fresnel/contracts/services";
import type { ToolRegistry } from "./registry.ts";
import { sha256HexSync } from "./util.ts";

// L1.tools.spec §4.13 (F.capabilities.spec §10 [결정: 2026-11-03 사용자]). 내장 도구를 같은 이름으로 대체하는 확장의 활성화 승인.
// 후보는 `pending`으로 등록되고 이 게이트가 승인 요청(kind `tool`, 도구 이름 `tool_replace`)을 올린다. 사용자가 허용하면 `active`가 되어
// 표에서 원본 대신 대체 항목이 보이고, 거부하면 `denied`로 남아 원본이 그대로 쓰인다. 승인 화면은 L4 화면 트랙이 맡는다.
// 요청 키가 후보(도구, 등록, 신뢰 등급)로 정해져 있어 같은 대화에서는 재시작 뒤에도 기록된 답을 다시 쓰고, 새 대화에서는 다시 묻는다.
// `remember`는 `once`뿐이라 영구 허용 규칙을 만들지 않는다.

/** 승인 요청 본문(args.notice)에 싣는 안내. 화면이 그대로 보이거나 번역한다 */
const TOOL_REPLACE_NOTICE =
  "Built-in file path protection runs inside the built-in tool. The replacement must enforce path protection itself; Fresnel does not apply it to the replacement.";

const TITLE_MAX = 120;

export interface ToolReplaceGate {
  /**
   * 승인 전이고 아직 요청하지 않은 대체마다 승인 요청을 올린다. 요청은 대화에 묶이므로 대화가 있을 때 부른다(`advertise`가 부른다).
   * 이미 요청했으면 아무것도 하지 않는다
   */
  requestPending(threadId: ThreadId): Promise<void>;
  /** 후보가 빠질 때(확장 해제) 열려 있는 요청을 닫는다 */
  cancel(approvalId: string): void;
  dispose(): void;
}

export interface ToolReplaceGateDeps {
  readonly approvals: Pick<ApprovalService, "open" | "wait" | "cancel">;
  readonly registry: ToolRegistry;
  readonly logger: Logger | undefined;
}

function titleOf(state: ToolReplacementState): string {
  const full = `Let "${state.extension}" replace the built-in tool "${state.toolName}"?`;
  return full.length <= TITLE_MAX ? full : `${full.slice(0, TITLE_MAX - 1)}…`;
}

/** 승인 요청 본문. 사용자가 무엇을 허용하는지 모두 담는다 */
function approvalInput(
  state: ToolReplacementState,
): Omit<ApprovalRequestInput, "origin"> & { readonly requestKey: string } {
  const hash = sha256HexSync(
    JSON.stringify([state.toolName, state.owner, state.extension, state.trust]),
  );
  return {
    requestKey: requestKeyFor(`toolrep:${state.toolName}:${hash.slice(0, 24)}`, sha256HexSync),
    title: titleOf(state),
    body: {
      kind: "tool",
      tool: {
        toolName: TOOL_REPLACE_APPROVAL_TOOL,
        risk: state.effectiveRisk,
        args: {
          tool: state.toolName,
          extension: state.extension,
          owner: state.owner,
          trust: state.trust,
          originalRisk: state.originalRisk,
          effectiveRisk: state.effectiveRisk,
          notice: TOOL_REPLACE_NOTICE,
        },
        argsHash: hash,
        ruleId: TOOL_REPLACE_RULE_ID,
      },
    },
    remember: ["once"],
  };
}

function keyOf(state: ToolReplacementState): string {
  return `${state.owner}\u0000${state.toolName}`;
}

export function createToolReplaceGate(deps: ToolReplaceGateDeps): ToolReplaceGate {
  const stop = new AbortController();
  /** 이 게이트가 대화에 올리는 중인 후보. 같은 후보를 두 번 올리지 않는다 */
  const opening = new Set<string>();

  function settle(state: ToolReplacementState, approvalId: string, allowed: boolean): void {
    // 후보가 그 사이에 빠졌으면 setReplacement가 false를 돌려주고 아무것도 바뀌지 않는다
    deps.registry.setReplacement(state.owner, state.toolName, {
      status: allowed ? "active" : "denied",
      approvalId,
    });
  }

  function watch(state: ToolReplacementState, approvalId: string): void {
    detach(
      deps.approvals.wait(approvalId, stop.signal).then((waited) => {
        if (!waited.ok) {
          // 기다림이 끊겼다(엔진 종료나 모르는 id). 후보는 pending으로 두고 다음 기회에 다시 요청한다
          deps.registry.setReplacement(state.owner, state.toolName, {
            status: "pending",
            approvalId: null,
          });
          return true;
        }
        const { decision, resolvedBy } = waited.value;
        if (decision === "allow" && resolvedBy === "user") {
          settle(state, approvalId, true);
        } else if (resolvedBy === "user") {
          settle(state, approvalId, false);
        } else {
          // 사용자가 답하지 않고 닫혔다(취소, 만료, 비대화형). 사용자의 거부가 아니므로 다시 물을 수 있게 둔다
          deps.registry.setReplacement(state.owner, state.toolName, {
            status: "pending",
            approvalId: null,
          });
        }
        return true;
      }),
      (cause) => {
        deps.logger?.warn("tools.replace_wait_failed", {
          tool: state.toolName,
          message: cause instanceof Error ? cause.name : "unknown",
        });
      },
    );
  }

  return {
    async requestPending(threadId) {
      for (const state of deps.registry.unrequested()) {
        const key = keyOf(state);
        if (opening.has(key)) continue;
        opening.add(key);
        try {
          // eslint-disable-next-line no-await-in-loop -- 후보마다 요청 하나씩 차례로 커밋한다
          const opened = await deps.approvals.open({
            ...approvalInput(state),
            origin: { threadId, turnId: null, stepId: null, toolCallId: null, caller: "host" },
          });
          if (!opened.ok) {
            deps.logger?.warn("tools.replace_request_failed", { tool: state.toolName });
            continue;
          }
          const { request, resolution } = opened.value;
          deps.registry.setReplacement(state.owner, state.toolName, {
            status: "pending",
            approvalId: request.approvalId,
          });
          if (resolution === null) {
            watch(state, request.approvalId);
          } else if (resolution.resolvedBy === "user") {
            settle(state, request.approvalId, resolution.decision === "allow");
          } else {
            deps.registry.setReplacement(state.owner, state.toolName, {
              status: "pending",
              approvalId: null,
            });
          }
        } finally {
          opening.delete(key);
        }
      }
    },
    cancel(approvalId) {
      detach(deps.approvals.cancel(approvalId, "tool replacement removed"), (cause) => {
        deps.logger?.warn("tools.replace_cancel_failed", {
          message: cause instanceof Error ? cause.name : "unknown",
        });
      });
    },
    dispose() {
      stop.abort();
    },
  };
}
