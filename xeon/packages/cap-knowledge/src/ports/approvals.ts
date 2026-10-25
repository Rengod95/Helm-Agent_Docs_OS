import { assertNever, canonicalJson, err, ok, parse, type Result } from "@xeon/contracts";
import type {
  CallContext,
  CapabilityId,
  LedgerOp,
  LedgerTarget,
  ScanSummary,
} from "@xeon/contracts/capabilities";
import type { JsonValue, ThreadId } from "@xeon/contracts/conversation";
import type {
  ApprovalRequestError,
  ApprovalRequestInput,
  ApprovalResolution,
  ApprovalService,
  CallerId,
} from "@xeon/contracts/services";
import { Type } from "typebox";
import { failure, type KnowledgeFailure } from "../errors.ts";
import { sha256Hex } from "../hash.ts";

// L2.knowledge.spec §4.5.1. 쓰기 승인 요청은 `xeon.approvals`(`ApprovalService`)의 도구 승인(kind `tool`)이다. 요청과 응답 기다림을
// 이 모듈 한 곳이 맡는다: `open`으로 요청을 커밋하고(같은 `requestKey`면 기존 요청을 돌려받는다) 해결이 없으면 `wait`로 기다린다.
// 기다리다 신호가 끊기면 기다림만 그만두고 요청은 남는다. 승인 결과 "항상"은 쓰지 않는다(스킬·메모리 쓰기는 매번 내용이 다르다).

/** 승인 창에 보이는 쓰기 하나. 미리보기는 현재 내용 기준 통합 diff다 */
export interface WriteApprovalRequest {
  readonly threadId: ThreadId;
  readonly context: CallContext;
  /** 같은 대화에서 같은 요청을 구분하는 키(1~48자). 같은 키의 두 번째 요청은 기존 요청이다 */
  readonly requestKey: string;
  /** 도구 이름. 모델 도구 경로면 `skill_manage`·`memory_manage`, 그 밖이면 능력 id */
  readonly toolName: string;
  readonly capability: { readonly id: CapabilityId; readonly method: string };
  readonly op: LedgerOp;
  readonly target: LedgerTarget;
  readonly baseHash: string | null;
  readonly preview: string;
  readonly scan: ScanSummary;
  /** 이번 turn에 웹·외부 결과를 읽었다. 승인 화면이 경고를 보인다(spec §4.6.3 3번) */
  readonly afterUntrusted: boolean;
}

export type WriteApprovalAnswer =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly feedback: string | undefined };

/** 사람에게 쓰기 승인을 묻는 포트. 실패는 값으로 돌려준다 */
export interface WriteApprovals {
  ask(
    request: WriteApprovalRequest,
    signal: AbortSignal,
  ): Promise<Result<WriteApprovalAnswer, KnowledgeFailure>>;
}

function callerOf(context: CallContext): CallerId {
  // 쓰기 승인은 주 대화와 확장(그룹)만 묻는다. 서브에이전트는 대기열로 간다
  return context.caller.kind === "model" && context.caller.agent === "subagent"
    ? "subagent:unknown"
    : "main";
}

function requestFailure(error: ApprovalRequestError): KnowledgeFailure {
  switch (error.kind) {
    case "store":
      return failure("unavailable", "the approval request could not be stored", {
        cause: error,
      });
    case "rejected":
      return failure("internal", `the approval service rejected the request: ${error.code}`, {
        cause: error,
      });
    case "key_reused":
      return failure("internal", "the approval request key was already used for another request", {
        cause: error,
      });
    default:
      return assertNever(error, "ApprovalRequestError");
  }
}

const DenyAnswerShape = Type.Object({ feedback: Type.String({ minLength: 1 }) });

/** 거부 응답의 `feedback`(records `DenyAnswerSchema`). 다른 모양이면 없는 것으로 본다 */
function feedbackOf(answer: JsonValue | null): string | undefined {
  const parsed = parse(DenyAnswerShape, answer);
  return parsed.ok ? parsed.value.feedback.slice(0, 500) : undefined;
}

function answerOf(resolution: ApprovalResolution): WriteApprovalAnswer {
  // 사람이 한 허용만 허용으로 센다. 취소, 대체, 비대화형 해결은 거부다
  if (resolution.decision === "allow" && resolution.resolvedBy === "user") return { kind: "allow" };
  return { kind: "deny", feedback: feedbackOf(resolution.answer) };
}

function titleOf(request: WriteApprovalRequest): string {
  const { op, target } = request;
  const what = target.kind === "skill" ? `skill ${target.name}` : `${target.name} memory`;
  return `Approve ${op} on ${what}?`.slice(0, 120);
}

/** `ApprovalService`(core-tools)를 쓰기 승인 포트로 감싼다 */
export function createWriteApprovals(service: ApprovalService): WriteApprovals {
  return {
    async ask(request, signal) {
      const args: Record<string, JsonValue> = {
        op: request.op,
        target: {
          kind: request.target.kind,
          name: request.target.name,
          ...(request.target.scope === undefined ? {} : { scope: request.target.scope }),
        },
        baseHash: request.baseHash,
        preview: request.preview,
        scan: {
          rulesetVersion: request.scan.rulesetVersion,
          findings: request.scan.findings.map((finding) => `${finding.rule}:${finding.severity}`),
        },
        afterUntrusted: request.afterUntrusted,
      };
      const input: ApprovalRequestInput = {
        origin: {
          threadId: request.threadId,
          turnId: request.context.turnId ?? null,
          stepId: null,
          toolCallId: request.context.toolCallId ?? null,
          caller: callerOf(request.context),
        },
        requestKey: request.requestKey,
        title: titleOf(request),
        body: {
          kind: "tool",
          tool: {
            toolName: request.toolName,
            capability: request.capability,
            risk: "write",
            args,
            argsHash: sha256Hex(canonicalJson(args)),
            ruleId: null,
          },
        },
        remember: ["once"],
      };
      const opened = await service.open(input);
      if (!opened.ok) return err(requestFailure(opened.error));
      if (opened.value.resolution !== null) return ok(answerOf(opened.value.resolution));
      const waited = await service.wait(opened.value.request.approvalId, signal);
      if (!waited.ok) {
        return err(
          waited.error.kind === "aborted"
            ? failure("aborted", "the wait for the write approval was aborted")
            : failure("unavailable", "the approval request is not known to this runtime"),
        );
      }
      return ok(answerOf(waited.value));
    },
  };
}
