import { t } from "@xeon/client/i18n";
import { assertNever, parse } from "@xeon/contracts";
import {
  TurnCompletedPayloadSchema,
  type ImageContent,
  type ItemRecord,
  type TextContent,
} from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  type ApprovalRequestedPayload,
  ApprovalResolvedPayloadSchema,
  EffectIntentSchema,
  ItemRecordedPayloadSchema,
  SettingsChangedPayloadSchema,
} from "@xeon/contracts/records";
import type { EventWire } from "@xeon/contracts/wire";
import type { ApprovalView, RenderOp, ToolCallView, ToolResultView } from "./ops.ts";
import { resultLines } from "./tools.ts";

// L4.cli.spec §4.5. 내구 이벤트(events.batch) 하나를 RenderOp로 바꾼다. 순수 함수.
// payload는 unknown으로 받아 F 스키마로 검사한 뒤 쓴다(TY-10). redactions가 있으면 가린 필드를 "[redacted]"로 되돌려 넣어
// 모양을 지킨다: 값을 복원하지 않는다.

const REDACTED_TEXT = "[redacted]";

export interface EventContext {
  /** 복구 규칙이 만든 결과의 effectId 집합(effect.result.synthesized) */
  readonly synthesized: ReadonlySet<string>;
  readonly width: number;
}

function unescapeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function setAt(node: unknown, tokens: readonly string[], value: unknown): unknown {
  const [head, ...rest] = tokens;
  if (head === undefined) return value;
  if (Array.isArray(node)) {
    const index = /^(0|[1-9]\d*)$/.test(head) ? Number(head) : -1;
    if (index < 0) return node;
    const copy = node.map((element: unknown) => element);
    copy[index] = setAt(copy[index], rest, value);
    return copy;
  }
  if (typeof node === "object" && node !== null) {
    const copy: Record<string, unknown> = Object.fromEntries(Object.entries(node));
    copy[head] = setAt(copy[head], rest, value);
    return copy;
  }
  return node;
}

/** 가린 필드 자리에 "[redacted]"를 넣은 사본을 돌려준다. 입력은 바꾸지 않는다 */
export function restoreRedactions(payload: unknown, pointers: readonly string[]): unknown {
  let current = payload;
  for (const pointer of pointers) {
    if (pointer !== "" && !pointer.startsWith("/")) continue;
    const tokens = pointer === "" ? [] : pointer.slice(1).split("/").map(unescapeToken);
    current = setAt(current, tokens, REDACTED_TEXT);
  }
  return current;
}

function blockText(block: TextContent | ImageContent): string {
  return block.type === "image" ? `[image ${block.mimeType}]` : block.text;
}

function userText(content: string | readonly (TextContent | ImageContent)[]): string {
  return typeof content === "string" ? content : content.map(blockText).join("\n");
}

const ARGS_SUMMARY_LIMIT = 120;

function summarize(text: string): string {
  const oneLine = text.replaceAll(/\s+/g, " ").trim();
  return oneLine.length <= ARGS_SUMMARY_LIMIT
    ? oneLine
    : `${oneLine.slice(0, ARGS_SUMMARY_LIMIT - 1)}…`;
}

function isBlobRef(value: unknown): boolean {
  return typeof value === "object" && value !== null && "sha256" in value;
}

const COMMAND_LINES_MAX = 40;
const SECRET_REF = /^secret:\/\/\S+$/;

/** 객체에서 이름이 같은 필드의 값. 없으면 undefined다 */
function fieldOf(object: object, name: string): unknown {
  return Object.entries(object).find(([key]) => key === name)?.[1];
}

/**
 * 도구 승인에서 인자 요약 120자가 가리는 내용을 따로 보인다(M2 검토 M2): 실행할 명령(`command` 문자열) 전체와, `secretEnv`로 쓸 비밀 핸들.
 * 승인이 비밀 사용의 증거가 되므로 사용자가 명령과 핸들을 보고 허용해야 한다. 핸들은 `secret://` 참조이고 값이 아니다.
 * 참조 모양이 아닌 값은 이름만 보인다
 */
function toolDetailLines(args: object): string[] {
  if (isBlobRef(args)) return [];
  const lines: string[] = [];
  const command = fieldOf(args, "command");
  if (typeof command === "string") {
    const rows = command.split("\n");
    lines.push(
      t("cli.render.transcript.command"),
      ...rows.slice(0, COMMAND_LINES_MAX).map((row) => `  ${row}`),
    );
    if (rows.length > COMMAND_LINES_MAX) {
      lines.push(
        t("cli.render.transcript.commandOmitted", {
          count: String(rows.length - COMMAND_LINES_MAX),
        }),
      );
    }
  }
  const env = fieldOf(args, "secretEnv");
  if (typeof env === "object" && env !== null) {
    const handles = Object.entries(env).map(([name, ref]: [string, unknown]) =>
      typeof ref === "string" && SECRET_REF.test(ref)
        ? `${name}=${ref}`
        : `${name}=${t("cli.render.transcript.badSecretRef")}`,
    );
    if (handles.length > 0)
      lines.push(t("cli.render.transcript.secrets", { handles: handles.join(", ") }));
  }
  return lines;
}

/**
 * 요청 주체(`origin.caller`, `approvalCallerOf`가 만든 형식)를 사람이 읽는 줄로 바꾼다. 사용자가 직접 연 대화의 메인 에이전트는
 * 보이지 않는다: 그 밖의 주체(서브에이전트, 확장, 백그라운드, 호스트)일 때만 누가 요청하는지 알려야 하기 때문이다
 */
function callerLine(caller: string): string[] {
  if (caller === "main") return [];
  if (caller === "background") return [t("cli.render.transcript.caller.background")];
  if (caller === "host") return [t("cli.render.transcript.caller.host")];
  if (caller.startsWith("subagent:"))
    return [t("cli.render.transcript.caller.subagent", { name: caller.slice(9) })];
  if (caller.startsWith("ext:"))
    return [t("cli.render.transcript.caller.extension", { name: caller.slice(4) })];
  return [t("cli.render.transcript.caller.other", { caller })];
}

/** 만료 시각(`expiresAt`, epoch ms)과 만료 때의 처리(`onExpire`)를 한 줄로 */
function expiryLine(payload: ApprovalRequestedPayload): string[] {
  if (payload.expiresAt === undefined) return [];
  const when = new Date(payload.expiresAt).toISOString();
  const action =
    payload.onExpire?.decision === "answer"
      ? t("cli.render.transcript.expiry.answer")
      : t("cli.render.transcript.expiry.deny");
  return [t("cli.render.transcript.expiresAt", { when, action })];
}

function itemOps(item: ItemRecord, ctx: EventContext, synthesizedResult: boolean): RenderOp[] {
  switch (item.kind) {
    case "user":
      return [{ kind: "user", itemId: item.itemId, text: userText(item.message.content) }];
    case "assistant": {
      const texts: string[] = [];
      const thoughts: string[] = [];
      for (const block of item.message.content) {
        if (block.type === "text") texts.push(block.text);
        else if (block.type === "thinking") thoughts.push(block.thinking);
      }
      const markdown = texts.join("\n");
      const thinking = thoughts.join("\n");
      if (markdown.length === 0 && thinking.length === 0) return [];
      return [
        {
          kind: "assistant",
          itemId: item.itemId,
          markdown,
          thinking: thinking.length === 0 ? null : thinking,
        },
      ];
    }
    case "system":
      return [];
    case "toolResult": {
      const { message } = item;
      const view: ToolResultView = {
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        isError: message.isError,
        synthesized: synthesizedResult,
        lines: resultLines(message.toolName, message.details, message.content, ctx.width),
      };
      return [{ kind: "toolResult", view }];
    }
    case "custom": {
      if (!item.message.display) return [];
      return [
        {
          kind: "custom",
          itemId: item.itemId,
          customType: item.message.customType,
          text: userText(item.message.content),
        },
      ];
    }
    default:
      return assertNever(item, "ItemRecord");
  }
}

/** 승인 요청 payload를 프롬프트가 쓰는 보기로 바꾼다. 이벤트(approval.requested)와 approval.list의 항목이 같이 쓴다 */
export function approvalViewOf(
  approvalId: string,
  payload: ApprovalRequestedPayload,
): ApprovalView {
  const { body, title, remember } = payload;
  switch (body.kind) {
    case "tool": {
      const args = isBlobRef(body.tool.args)
        ? t("cli.render.transcript.bigArgs")
        : summarize(JSON.stringify(body.tool.args));
      return {
        approvalId,
        title,
        body: [
          ...callerLine(payload.origin.caller),
          t("cli.render.transcript.tool", { name: body.tool.toolName, risk: body.tool.risk }),
          t("cli.render.transcript.args", { args }),
          ...toolDetailLines(body.tool.args),
          ...expiryLine(payload),
        ],
        allowsAnswer: false,
        remember,
        form: { kind: "tool" },
      };
    }
    case "plan": {
      const plan =
        typeof body.plan.plan === "string"
          ? body.plan.plan
          : t("cli.render.transcript.attachedPlan");
      return {
        approvalId,
        title,
        body: [...callerLine(payload.origin.caller), ...plan.split("\n"), ...expiryLine(payload)],
        allowsAnswer: false,
        remember,
        form: { kind: "plan", nextModes: body.plan.nextModes },
      };
    }
    case "question":
      return {
        approvalId,
        title,
        body: [
          ...callerLine(payload.origin.caller),
          ...body.question.questions.map((question) => question.text),
          ...expiryLine(payload),
        ],
        allowsAnswer: true,
        remember,
        form: {
          kind: "question",
          questions: body.question.questions.map((question) => ({
            id: question.id,
            header: question.header ?? null,
            text: question.text,
            options: question.options.map((option) => ({
              id: option.id,
              label: option.label,
              description: option.description ?? null,
              recommended: option.recommended === true,
            })),
            multiSelect: question.multiSelect,
            allowFreeText: question.allowFreeText,
          })),
        },
      };
    case "review":
      // 검토 승인(ADR-0018). 요약(파일, hunk 수)만 보이고 hunk 본문은 싣지 않는다. 답은 ReviewAnswer(approval.ts)
      return {
        approvalId,
        title,
        body: [
          ...callerLine(payload.origin.caller),
          t("cli.render.transcript.review", {
            title: body.review.title,
            round: String(body.review.round),
          }),
          ...body.review.files.map(
            (file) => `${file.change} ${file.path} (hunk ${String(file.hunks)})`,
          ),
          ...expiryLine(payload),
        ],
        allowsAnswer: true,
        remember,
        form: {
          kind: "review",
          files: body.review.files.map((file) => ({ path: file.path, hunks: file.hunks })),
        },
      };
    default:
      return assertNever(body, "ApprovalBody");
  }
}

function approvalView(event: EventWire, payload: unknown): ApprovalView | undefined {
  const parsed = parse(ApprovalRequestedPayloadSchema, payload);
  return parsed.ok ? approvalViewOf(event.id, parsed.value) : undefined;
}

function unreadable(kind: string): RenderOp[] {
  return [{ kind: "notice", text: t("cli.render.transcript.unreadable", { kind }) }];
}

/** 내구 이벤트 하나를 그리기 명령으로 바꾼다. 그리지 않는 kind는 빈 배열이다 */
export function opsOfEvent(event: EventWire, ctx: EventContext): readonly RenderOp[] {
  const payload = restoreRedactions(event.payload, event.redactions);
  const { kind } = event;
  if (kind === "item.recorded") {
    const parsed = parse(ItemRecordedPayloadSchema, payload);
    if (!parsed.ok) return unreadable(kind);
    const { item } = parsed.value;
    const effectId = item.kind === "toolResult" ? item.effectId : null;
    return itemOps(item, ctx, effectId !== null && ctx.synthesized.has(effectId));
  }
  if (kind === "effect.intent") {
    const parsed = parse(EffectIntentSchema, payload);
    if (!parsed.ok) return unreadable(kind);
    const intent = parsed.value;
    const view: ToolCallView = {
      itemId: intent.itemId,
      toolCallId: intent.toolCallId,
      toolName: intent.toolName,
      argsSummary: isBlobRef(intent.args)
        ? t("cli.render.transcript.bigArgs")
        : summarize(JSON.stringify(intent.args)),
    };
    return [{ kind: "toolCall", view }];
  }
  if (kind === "turn.completed") {
    const parsed = parse(TurnCompletedPayloadSchema, payload);
    if (!parsed.ok) return unreadable(kind);
    return [{ kind: "turnEnd", status: parsed.value.status, error: parsed.value.error }];
  }
  if (kind === "approval.requested") {
    const view = approvalView(event, payload);
    return view === undefined ? unreadable(kind) : [{ kind: "approval", view }];
  }
  if (kind === "approval.resolved") {
    const parsed = parse(ApprovalResolvedPayloadSchema, payload);
    if (!parsed.ok) return unreadable(kind);
    const { approvalId, decision, remember, requestedRemember, resolvedBy } = parsed.value;
    return [
      { kind: "approvalResolved", approvalId, decision, remember, requestedRemember, resolvedBy },
    ];
  }
  if (kind === "settings.changed") {
    const parsed = parse(SettingsChangedPayloadSchema, payload);
    if (!parsed.ok) return unreadable(kind);
    // 값은 보이지 않는다: 비밀 참조일 수 있고, 키와 범위만으로 충분하다
    return [
      {
        kind: "notice",
        text: t("cli.render.transcript.settingChanged", {
          key: parsed.value.key,
          scope: parsed.value.scope,
        }),
      },
    ];
  }
  // thread.*, turn.started, step.*, part.recorded, effect.exec/result, checkpoint.step, lease.*, scope.changed,
  // input.*, agent.*, secret.*, 확장 kind(x.*, grp.*)는 트랜스크립트에 그리지 않는다
  return [];
}
