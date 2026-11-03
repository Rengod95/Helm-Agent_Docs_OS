import { Type } from "typebox";
import { assertNever, parse } from "../base/index.ts";
import {
  applyLeafMasks,
  JsonObjectSchema,
  maskText,
  type LeafMask,
} from "../conversation/index.ts";
import { BlobRefSchema } from "./blob.ts";
import type { ApprovalRequestedPayload } from "./catalog/approval.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a [결정: 2026-11-03 사용자].
// 승인 카드의 화면 가림. 호스트가 approval.requested의 제목, 출처, 본문에 구한 구간을 같은 문자열에 적용한다.
// 본문의 문자열은 종류마다 필드를 하나씩 적용한다. 길이 상한이 있는 필드에 가린 뒤 스키마를 다시 검사하면 카드가 사라지므로 다시 검사하지 않는다.
// 도구 인자는 자유 JSON이라 적용 뒤 모양만 검사한다(BlobRef면 그대로).
// 식별자(요청 키, 세션 thread, 승인 식별자)는 화면 글이 아니므로 바뀌지 않는다.

const TITLE_POINTER = "/title";
const ARGS_POINTER = "/body/tool/args";
const ToolArgsSchema = Type.Union([JsonObjectSchema, BlobRefSchema]);

type Body = ApprovalRequestedPayload["body"];

function leafAt(leaves: readonly LeafMask[], pointer: string): LeafMask | undefined {
  return leaves.find((leaf) => leaf.pointer === pointer);
}

/** 인자 쪽 표식만 골라 인자 기준 포인터로 바꾼다 */
function argsLeaves(leaves: readonly LeafMask[]): LeafMask[] {
  const out: LeafMask[] = [];
  for (const leaf of leaves) {
    if (leaf.pointer === ARGS_POINTER) out.push({ ...leaf, pointer: "" });
    else if (leaf.pointer.startsWith(`${ARGS_POINTER}/`)) {
      out.push({ ...leaf, pointer: leaf.pointer.slice(ARGS_POINTER.length) });
    }
  }
  return out;
}

/** 본문 하나를 종류별로 가린다. 문자열 필드마다 같은 자리의 표식을 적용한다. 인자만 모양을 다시 검사한다 */
function maskBody(body: Body, leaves: readonly LeafMask[]): Body | null {
  const m = (pointer: string, text: string): string => maskText(text, leafAt(leaves, pointer));
  switch (body.kind) {
    case "tool": {
      const tool = body.tool;
      const args = applyLeafMasks(tool.args, argsLeaves(leaves));
      if (!args.ok) return null;
      const checked = parse(ToolArgsSchema, args.value);
      if (!checked.ok) return null;
      return {
        kind: "tool",
        tool: {
          ...tool,
          toolName: m("/body/tool/toolName", tool.toolName),
          risk: m("/body/tool/risk", tool.risk),
          argsHash: m("/body/tool/argsHash", tool.argsHash),
          ruleId: tool.ruleId === null ? null : m("/body/tool/ruleId", tool.ruleId),
          ...(tool.capability === undefined
            ? {}
            : {
                capability: {
                  id: m("/body/tool/capability/id", tool.capability.id),
                  method: m("/body/tool/capability/method", tool.capability.method),
                },
              }),
          args: checked.value,
        },
      };
    }
    case "plan": {
      const plan = body.plan;
      return {
        kind: "plan",
        plan: {
          ...plan,
          plan: typeof plan.plan === "string" ? m("/body/plan/plan", plan.plan) : plan.plan,
          planRef: plan.planRef === null ? null : m("/body/plan/planRef", plan.planRef),
          nextModes: plan.nextModes.map((mode, index) =>
            m(`/body/plan/nextModes/${String(index)}`, mode),
          ),
        },
      };
    }
    case "question":
      return {
        kind: "question",
        question: {
          questions: body.question.questions.map((question, qi) => {
            const at = `/body/question/questions/${String(qi)}`;
            return {
              id: m(`${at}/id`, question.id),
              ...(question.header === undefined
                ? {}
                : { header: m(`${at}/header`, question.header) }),
              text: m(`${at}/text`, question.text),
              options: question.options.map((option, oi) => {
                const optAt = `${at}/options/${String(oi)}`;
                return {
                  id: m(`${optAt}/id`, option.id),
                  label: m(`${optAt}/label`, option.label),
                  ...(option.description === undefined
                    ? {}
                    : { description: m(`${optAt}/description`, option.description) }),
                  ...(option.recommended === undefined ? {} : { recommended: option.recommended }),
                };
              }),
              multiSelect: question.multiSelect,
              allowFreeText: question.allowFreeText,
            };
          }),
        },
      };
    case "review": {
      const review = body.review;
      return {
        kind: "review",
        review: {
          ...review,
          reviewId: m("/body/review/reviewId", review.reviewId),
          artifactId: m("/body/review/artifactId", review.artifactId),
          title: m("/body/review/title", review.title),
          files: review.files.map((file, index) => ({
            path: m(`/body/review/files/${String(index)}/path`, file.path),
            change: file.change,
            binary: file.binary,
            hunks: file.hunks,
          })),
        },
      };
    }
    default:
      return assertNever(body, "approval body kind");
  }
}

/**
 * 승인 요청의 제목, 출처, 본문에 표식을 적용한 복사본을 돌려준다. 입력은 바뀌지 않는다.
 * 표식이 맞지 않는 자리는 `[REDACTED:unverified]`다. 도구 인자가 모양을 벗어나면 `null`이다(카드를 읽을 수 없는 것으로 둔다).
 * 요청 키, 세션 thread, 승인 식별자는 바뀌지 않는다.
 */
export function maskApprovalRequest(
  request: ApprovalRequestedPayload,
  leaves: readonly LeafMask[] | undefined,
): ApprovalRequestedPayload | null {
  if (leaves === undefined || leaves.length === 0) return request;
  const title = maskText(request.title, leafAt(leaves, TITLE_POINTER));
  const origin = {
    ...request.origin,
    caller: maskText(request.origin.caller, leafAt(leaves, "/origin/caller")),
    toolCallId:
      request.origin.toolCallId === null
        ? null
        : maskText(request.origin.toolCallId, leafAt(leaves, "/origin/toolCallId")),
  };
  const body = maskBody(request.body, leaves);
  if (body === null) return null;
  return { ...request, title, origin, body };
}
