import type { MessageId } from "@fresnel/client/i18n";
import { parseJson } from "@fresnel/contracts";
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
  gone: "desktop.approvals.failure.gone",
  locked: "desktop.approvals.failure.locked",
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

// ── 파일 변경(edit, write) ───────────────────────────────────────────────

/** 파일 변경 미리보기의 한 줄. `context`는 바뀌지 않은 앞뒤 줄이다 */
export type FileChangeRow = {
  readonly kind: "context" | "add" | "remove";
  readonly text: string;
};

/**
 * 파일 변경 승인의 그림 값. 파일은 승인 시점에 읽지 않으므로 줄 번호가 없다.
 * `edit`은 바뀐 줄의 diff이고, 앞 `DIFF_HEAD_ROWS`줄 뒤는 `rest`로 접는다. `write`는 쓸 내용의 앞 줄과 남은 줄 수다.
 */
export type FileChangeView =
  | {
      readonly kind: "edit";
      readonly path: string;
      readonly head: readonly FileChangeRow[];
      readonly rest: readonly FileChangeRow[];
    }
  | {
      readonly kind: "write";
      readonly path: string;
      readonly head: readonly string[];
      readonly hiddenLines: number;
    };

const DIFF_CONTEXT_LINES = 2;
const DIFF_HEAD_ROWS = 30;
const WRITE_HEAD_LINES = 40;

type Replacement = { readonly oldText: string; readonly newText: string };

function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** 글을 줄로 나눈다. 빈 글은 줄이 없고, 끝의 줄바꿈 하나는 줄을 늘리지 않는다 */
function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function rowsOf(lines: readonly string[], kind: FileChangeRow["kind"]): FileChangeRow[] {
  return lines.map((text): FileChangeRow => ({ kind, text }));
}

/**
 * 바꿀 곳 하나를 diff 줄로 바꾼다. 앞뒤 공통 줄은 떼고, 떼어 낸 줄 중 가까운 `DIFF_CONTEXT_LINES`줄만 문맥으로 남긴다.
 * 바뀐 줄이 없으면(옛 글과 새 글이 같으면) 빈 목록이다.
 */
function replacementRowsOf(oldText: string, newText: string): FileChangeRow[] {
  const before = linesOf(oldText);
  const after = linesOf(newText);
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  if (removed.length === 0 && added.length === 0) return [];
  const leading = before.slice(Math.max(0, prefix - DIFF_CONTEXT_LINES), prefix);
  const trailing = before.slice(
    before.length - suffix,
    before.length - suffix + Math.min(DIFF_CONTEXT_LINES, suffix),
  );
  return [
    ...rowsOf(leading, "context"),
    ...rowsOf(removed, "remove"),
    ...rowsOf(added, "add"),
    ...rowsOf(trailing, "context"),
  ];
}

function replacementOf(value: unknown): Replacement | null {
  if (!isRecordValue(value)) return null;
  const oldText = value["oldText"];
  const newText = value["newText"];
  return typeof oldText === "string" && typeof newText === "string" ? { oldText, newText } : null;
}

/** `edits`의 세 모양(배열, 객체 하나, 그 둘의 JSON 문자열)을 항목 목록으로 바꾼다. 모양이 아니면 null */
function editItemsOf(value: unknown): readonly unknown[] | null {
  let shaped: unknown = value;
  if (typeof value === "string") {
    const parsed = parseJson(value);
    if (!parsed.ok) return null;
    shaped = parsed.value;
  }
  if (isUnknownArray(shaped)) return shaped;
  return isRecordValue(shaped) ? [shaped] : null;
}

/**
 * 인자에서 바꿀 곳 목록을 읽는다. `edits`가 있으면 그 항목을, 없거나 빈 배열이면 최상위 `oldText`·`newText` 한 쌍을 쓴다(도구의 규칙과 같다).
 * 항목 하나라도 모양이 다르면 null이다. 그러면 카드는 인자 JSON만 보인다.
 */
function replacementsOf(args: Readonly<Record<string, JsonValue>>): readonly Replacement[] | null {
  const edits = args["edits"];
  let items: readonly unknown[] = [];
  if (edits !== undefined) {
    const shaped = editItemsOf(edits);
    if (shaped === null) return null;
    items = shaped;
  }
  if (items.length === 0) {
    const oldText = args["oldText"];
    const newText = args["newText"];
    return typeof oldText === "string" && typeof newText === "string"
      ? [{ oldText, newText }]
      : null;
  }
  const replacements: Replacement[] = [];
  for (const item of items) {
    const replacement = replacementOf(item);
    if (replacement === null) return null;
    replacements.push(replacement);
  }
  return replacements;
}

/**
 * 도구 호출 인자에서 파일 변경 그림을 만든다. `edit`과 `write`만 그림이 있다. 다른 도구, 모양이 맞지 않는 인자는 null이라 호출 행은 옛 모습(인자 JSON)을 그린다.
 * 승인 카드(`fileChangeViewOf`)와 트랜스크립트 도구 행이 같이 쓴다. 인자는 프로세스 밖에서 온 값이라 던지지 않고 모양만 본다.
 */
export function fileChangeViewOfArgs(
  toolName: string,
  args: Readonly<Record<string, JsonValue>>,
): FileChangeView | null {
  if (toolName !== "edit" && toolName !== "write") return null;
  const path = args["path"];
  if (typeof path !== "string" || path.trim() === "") return null;
  if (toolName === "write") {
    const content = args["content"];
    if (typeof content !== "string") return null;
    const lines = linesOf(content);
    return {
      kind: "write",
      path,
      head: lines.slice(0, WRITE_HEAD_LINES),
      hiddenLines: Math.max(0, lines.length - WRITE_HEAD_LINES),
    };
  }
  const replacements = replacementsOf(args);
  if (replacements === null) return null;
  const rows = replacements.flatMap((replacement) =>
    replacementRowsOf(replacement.oldText, replacement.newText),
  );
  return {
    kind: "edit",
    path,
    head: rows.slice(0, DIFF_HEAD_ROWS),
    rest: rows.slice(DIFF_HEAD_ROWS),
  };
}

/**
 * `edit`과 `write` 승인의 파일 변경 그림. 저장된 인자(BlobRef)는 본문이 없어 null이고, 그 밖은 `fileChangeViewOfArgs`가 정한다.
 */
export function fileChangeViewOf(body: ToolApprovalBody): FileChangeView | null {
  if (isBlobRef(body.args)) return null;
  return fileChangeViewOfArgs(body.toolName, body.args);
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
  | { readonly kind: "group"; readonly name: string }
  /** 그룹이 띄운 하위 에이전트(Helm 렌즈 등). 화면은 "<이름> · grp:<그룹>"이다. 이름이 없으면 하위 에이전트 이름 */
  | {
      readonly kind: "groupChild";
      readonly name: string;
      readonly label: string | null;
      readonly scope: string;
    };

/** 승인 origin의 요청자와 출처(`origin.source`)로 표시를 만든다. 출처가 있고 하위 에이전트이면 소유 그룹을 함께 보인다 */
export function approvalOriginView(
  caller: string,
  source?: { readonly scopeId: string; readonly label: string | null },
): ApprovalOriginView | null {
  if (source !== undefined && caller.startsWith("subagent:")) {
    return {
      kind: "groupChild",
      name: caller.slice(9),
      label: source.label,
      scope: source.scopeId,
    };
  }
  if (caller === "background") return { kind: "background" };
  if (caller === "host") return { kind: "host" };
  if (caller.startsWith("subagent:")) return { kind: "subagent", name: caller.slice(9) };
  if (caller.startsWith("ext:")) return { kind: "group", name: caller.slice(4) };
  return null;
}
