import type { MessageId } from "@fresnel/client/i18n";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { ApprovalRequestedPayload, BlobRef } from "@fresnel/contracts/records";
import { TOOL_REPLACE_APPROVAL_TOOL } from "@fresnel/contracts/services";
import type { ApprovalSend } from "../state/ui/index.ts";

// 승인 카드의 순수 로직(L4.desktop.spec §4.13). 도구 승인 카드가 보이는 값과 질문 카드의 답 조립을 React 밖에서 시험한다.
// 질문 응답은 core-tools `validateResponse`(L1.tools.spec §3.6)가 받는 모양으로만 만든다: 모든 질문에 답이 하나씩,
// 선택은 선택지 안에서, 다중 선택이 아니면 하나, 자유 입력은 허용된 질문에만, 빈 답은 없다.

/** 검토 파일의 변경 종류 문장. 승인 카드와 변경 검토 화면이 같이 쓴다 */
export const REVIEW_CHANGE_ID: Readonly<
  Record<"added" | "modified" | "deleted" | "renamed", MessageId>
> = {
  added: "desktop.approvals.review.change.added",
  modified: "desktop.approvals.review.change.modified",
  deleted: "desktop.approvals.review.change.deleted",
  renamed: "desktop.approvals.review.change.renamed",
};

/** 응답을 보낸 뒤 실패로 남은 표시의 문장. 승인 카드와 변경 검토 화면이 같이 쓴다. `sending`은 문장이 없다 */
export const APPROVAL_FAILURE_ID: Readonly<Record<Exclude<ApprovalSend, "sending">, MessageId>> = {
  failed: "desktop.approvals.failure.failed",
  invalid: "desktop.approvals.failure.invalid",
  closed: "desktop.approvals.failure.closed",
  unapplied: "desktop.approvals.failure.unapplied",
  switching: "desktop.approvals.failure.switching",
};

// 거울이 쥔 승인은 wire payload 모양이다(ApprovalRequestedPayload). 서비스 쪽 타입은 브랜드 문자열을 써서 쓰지 않는다
export type ToolApprovalBody = Extract<ApprovalRequestedPayload["body"], { kind: "tool" }>["tool"];
export type QuestionItem = Extract<
  ApprovalRequestedPayload["body"],
  { kind: "question" }
>["question"]["questions"][number];

const FREE_TEXT_MAX = 8192;
const ARGS_TEXT_MAX = 4000;
const COMMAND_TEXT_MAX = 4000;
const SECRET_REF = /^secret:\/\/\S+$/;

// ── 도구 승인 ────────────────────────────────────────────────────────────

type SecretUse = {
  readonly name: string;
  /** `secret://` 참조. 값이 아니라 핸들이다. 참조 모양이 아니면 null이고 이름만 보인다 */
  readonly handle: string | null;
};

export type ToolApprovalView = {
  readonly toolName: string;
  readonly risk: string;
  /** `command` 인자가 문자열이면 그 값(bash 같은 셸 도구) */
  readonly command: string | null;
  /** 인자 전체(JSON, 길이 상한). 인자가 BlobRef면 null */
  readonly argsText: string | null;
  readonly argsTruncated: boolean;
  /** 큰 인자라 본문이 별도 저장소에 있다 */
  readonly argsStored: boolean;
  /** `secretEnv`로 쓰려는 시크릿. 비어 있으면 시크릿을 쓰지 않는다 */
  readonly secrets: readonly SecretUse[];
};

function isBlobRef(args: ToolApprovalBody["args"]): args is BlobRef {
  return args["type"] === "blob" && typeof args["sha256"] === "string";
}

function isRecord(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function secretsOf(args: Readonly<Record<string, JsonValue>>): readonly SecretUse[] {
  const env = args["secretEnv"];
  if (!isRecord(env)) return [];
  return Object.entries(env).map(([name, ref]) => ({
    name,
    handle: typeof ref === "string" && SECRET_REF.test(ref) ? ref : null,
  }));
}

function clip(text: string, max: number): { readonly text: string; readonly clipped: boolean } {
  return text.length <= max
    ? { text, clipped: false }
    : { text: text.slice(0, max), clipped: true };
}

/** 도구 승인 본문을 카드가 그리는 값으로 바꾼다. 사용자는 실행될 명령, 인자, 쓸 시크릿 참조을 보고 허용한다 */
export function toolApprovalView(body: ToolApprovalBody): ToolApprovalView {
  const base = { toolName: body.toolName, risk: body.risk };
  const { args } = body;
  if (isBlobRef(args)) {
    return {
      ...base,
      command: null,
      argsText: null,
      argsTruncated: false,
      argsStored: true,
      secrets: [],
    };
  }
  const command = args["command"];
  const shown = clip(JSON.stringify(args, null, 2), ARGS_TEXT_MAX);
  return {
    ...base,
    command: typeof command === "string" ? clip(command, COMMAND_TEXT_MAX).text : null,
    argsText: shown.text,
    argsTruncated: shown.clipped,
    argsStored: false,
    secrets: secretsOf(args),
  };
}

// ── 내장 도구 대체 승인 ──────────────────────────────────────────────────

type ReplaceTrust = "builtin" | "user" | "project" | "untrusted";
const REPLACE_TRUSTS: readonly ReplaceTrust[] = ["builtin", "user", "project", "untrusted"];

export type ToolReplaceView = {
  /** 대체될 내장 도구 이름 */
  readonly tool: string;
  /** 대체하는 확장 이름 */
  readonly extension: string;
  /** 확장의 신뢰 등급. 모르는 값이면 null이고 카드는 등급 줄을 그리지 않는다 */
  readonly trust: ReplaceTrust | null;
  readonly originalRisk: string;
  readonly effectiveRisk: string;
  /** 대체 도구가 경로 보호를 스스로 지켜야 한다는 안내가 본문에 실려 왔는지. 실려 오지 않아도 카드는 안내를 그린다 */
  readonly hasNotice: boolean;
};

function textOf(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * 도구 승인 본문이 내장 도구 대체 승인이면 카드가 그리는 값으로 바꾼다. 아니면 null이다.
 * 인자는 프로세스 밖에서 온 값이라 모양을 확인하고, 필수 값(대상 도구, 확장 이름)이 없으면 일반 도구 승인으로 그린다.
 */
export function toolReplaceView(body: ToolApprovalBody): ToolReplaceView | null {
  if (body.toolName !== TOOL_REPLACE_APPROVAL_TOOL || isBlobRef(body.args)) return null;
  const { args } = body;
  const tool = textOf(args["tool"]);
  const extension = textOf(args["extension"]);
  if (tool === null || extension === null) return null;
  const trust = REPLACE_TRUSTS.find((candidate) => candidate === args["trust"]) ?? null;
  return {
    tool,
    extension,
    trust,
    originalRisk: textOf(args["originalRisk"]) ?? body.risk,
    effectiveRisk: textOf(args["effectiveRisk"]) ?? body.risk,
    hasNotice: textOf(args["notice"]) !== null,
  };
}

// ── 질문 ─────────────────────────────────────────────────────────────────

/** 질문 하나의 입력 상태. 선택한 선택지 id 목록과 자유 입력 */
type QuestionPick = { readonly selected: readonly string[]; readonly text: string };

/** 질문 id → 입력 상태. 없는 id는 아직 손대지 않은 질문이다 */
export type QuestionDraft = Readonly<Record<string, QuestionPick>>;

const EMPTY_PICK: QuestionPick = { selected: [], text: "" };

function pickOf(draft: QuestionDraft, id: string): QuestionPick {
  return draft[id] ?? EMPTY_PICK;
}

/** 선택지를 누른다. 다중 선택이면 토글하고, 아니면 그 선택지 하나로 바꾼다(이미 골랐으면 해제) */
export function togglePick(
  draft: QuestionDraft,
  question: QuestionItem,
  optionId: string,
): QuestionDraft {
  const current = pickOf(draft, question.id);
  const has = current.selected.includes(optionId);
  let selected: readonly string[];
  if (question.multiSelect) {
    selected = has
      ? current.selected.filter((id) => id !== optionId)
      : [...current.selected, optionId];
  } else {
    selected = has ? [] : [optionId];
  }
  return { ...draft, [question.id]: { ...current, selected } };
}

export function setPickText(draft: QuestionDraft, questionId: string, text: string): QuestionDraft {
  return { ...draft, [questionId]: { ...pickOf(draft, questionId), text } };
}

export type QuestionAnswerWire = Readonly<Record<string, { selected: string[]; text?: string }>>;

/**
 * 입력 상태를 응답으로 바꾼다. 모든 질문에 선택이나 자유 입력이 하나는 있어야 하고, 아니면 null이다(보내기 버튼을 끈다).
 * 자유 입력을 허용하지 않는 질문의 text는 버리고, 앞뒤 공백만 있는 입력은 없는 것으로 본다
 */
export function answerOf(
  questions: readonly QuestionItem[],
  draft: QuestionDraft,
): QuestionAnswerWire | null {
  const out: Record<string, { selected: string[]; text?: string }> = {};
  for (const question of questions) {
    const pick = pickOf(draft, question.id);
    const optionIds = new Set(question.options.map((option) => option.id));
    const selected = pick.selected.filter((id) => optionIds.has(id));
    if (!question.multiSelect && selected.length > 1) return null;
    const text = question.allowFreeText ? pick.text.trim() : "";
    if (text.length > FREE_TEXT_MAX) return null;
    if (selected.length === 0 && text.length === 0) return null;
    out[question.id] = text.length === 0 ? { selected } : { selected, text };
  }
  return out;
}

export const QUESTION_TEXT_MAX: number = FREE_TEXT_MAX;

// ── 요청한 곳(U-7) ───────────────────────────────────────────────────────

/** 승인 출처 표시. `main`은 보이지 않는다(null). 확장 caller `ext:<이름>`은 그룹 이름으로 보인다(화면은 `grp:<이름>`) */
export type ApprovalOriginView =
  | { readonly kind: "background" }
  | { readonly kind: "host" }
  | { readonly kind: "subagent"; readonly name: string }
  | { readonly kind: "group"; readonly name: string };

export function approvalOriginView(caller: string): ApprovalOriginView | null {
  if (caller === "background") return { kind: "background" };
  if (caller === "host") return { kind: "host" };
  if (caller.startsWith("subagent:")) return { kind: "subagent", name: caller.slice(9) };
  if (caller.startsWith("ext:")) return { kind: "group", name: caller.slice(4) };
  return null;
}
