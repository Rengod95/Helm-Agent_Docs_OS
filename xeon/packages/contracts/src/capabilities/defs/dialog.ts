import {
  Type,
  type Static,
  type TLiteral,
  type TObject,
  type TSchema,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import type { SchemaProof, SchemaSound } from "../../base/index.ts";
import {
  ImageContentSchema,
  JsonValueSchema,
  TextContentSchema,
  ApprovalIdSchema,
  type ApprovalId,
  type ImageContent,
  type JsonValue,
  type TextContent,
  type ThreadId,
} from "../../conversation/index.ts";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolContent, ToolSpec } from "../tool-spec.ts";
import { ImageBlobRefSchema } from "./workspace.ts";

// L2.dialog.spec §3. 정의 파일은 이 파일 하나다. 순수 함수(checkAskQuestions, validateAskAnswer,
// buildAskAnswerSchema, defaultAskAnswer, renderAsk)는 L1.tools와 L4 질문 화면도 import해 쓴다(§8).

const ShortId = Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,31}$" });

/** 입력이 없는 메서드가 쓴다 */
const EmptyInput: TObject<{}> = Type.Object({}, { additionalProperties: false });
const EmptyOutput: TObject<{}> = Type.Object({});

// ── dialog.ask (§3.1) ──────────────────────────────────────────────────

export type AskOption = {
  id: string;
  label: string;
  description?: string;
  /** 추천 항목. 질문마다 최대 하나. 시간 초과 시 이 항목을 고른다(§4.1.3) */
  recommended?: boolean;
};
const askOptionShape = Type.Object(
  {
    id: ShortId,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    description: Type.Optional(Type.String({ maxLength: 300 })),
    recommended: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const AskOptionSchema: TUnsafe<AskOption> = Type.Unsafe<AskOption>(
  askOptionShape satisfies SchemaProof<AskOption, typeof askOptionShape>,
);

export type AskQuestion = {
  id: string;
  /** 화면의 짧은 머리표. 예: "범위" */
  header?: string;
  question: string;
  /** 없으면 자유 입력 질문이다 */
  options?: AskOption[];
  multiSelect?: boolean;
  /** 선택지가 있을 때 자유 입력도 받을지. 기본 true */
  allowFreeText?: boolean;
};
const askQuestionShape = Type.Object(
  {
    id: ShortId,
    header: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
    question: Type.String({ minLength: 1, maxLength: 1000 }),
    options: Type.Optional(Type.Array(AskOptionSchema, { minItems: 2, maxItems: 8 })),
    multiSelect: Type.Optional(Type.Boolean()),
    allowFreeText: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const AskQuestionSchema: TUnsafe<AskQuestion> = Type.Unsafe<AskQuestion>(
  askQuestionShape satisfies SchemaProof<AskQuestion, typeof askQuestionShape>,
);

export type AskParamsValue = {
  questions: AskQuestion[];
  /** 답을 기다리는 최대 시간(초). 생략하면 설정 l2.dialog.ask.timeoutSec. 0은 제한 없음 */
  timeoutSec?: number;
};
const askParamsFields = {
  questions: Type.Array(AskQuestionSchema, { minItems: 1, maxItems: 4 }),
  timeoutSec: Type.Optional(Type.Integer({ minimum: 0, maximum: 86400 })),
};
const askParamsShape = Type.Object(askParamsFields, { additionalProperties: false });
export const AskParams: TUnsafe<AskParamsValue> = Type.Unsafe<AskParamsValue>(
  askParamsShape satisfies SchemaProof<AskParamsValue, typeof askParamsShape>,
);

export type AskInputValue = AskParamsValue & {
  /** 참이면 답이 올 때까지 반환을 미룬다(메모리 대기). 도구 경로는 거짓(§4.1.4) */
  wait?: boolean;
};
const askInputShape = Type.Object(
  { ...askParamsFields, wait: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export const AskInput: TUnsafe<AskInputValue> = Type.Unsafe<AskInputValue>(
  askInputShape satisfies SchemaProof<AskInputValue, typeof askInputShape>,
);

export type AskAnswerItem = {
  questionId: string;
  /** 고른 선택지 id. 자유 입력만 했으면 빈 배열 */
  selected: string[];
  text: string | null;
};
const askAnswerItemShape = Type.Object(
  {
    questionId: ShortId,
    selected: Type.Array(ShortId, { maxItems: 8, uniqueItems: true }),
    text: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const AskAnswerItemSchema: TUnsafe<AskAnswerItem> = Type.Unsafe<AskAnswerItem>(
  askAnswerItemShape satisfies SchemaProof<AskAnswerItem, typeof askAnswerItemShape>,
);

/** 승인 응답(decision "answer")의 answer 내용 */
export type AskAnswer = { answers: AskAnswerItem[] };
const askAnswerShape = Type.Object(
  { answers: Type.Array(AskAnswerItemSchema, { minItems: 1, maxItems: 4 }) },
  { additionalProperties: false },
);
export const AskAnswerSchema: TUnsafe<AskAnswer> = Type.Unsafe<AskAnswer>(
  askAnswerShape satisfies SchemaProof<AskAnswer, typeof askAnswerShape>,
);

export type AskCancelReason = "timeout" | "dismissed" | "aborted";
export type AskResult =
  | { status: "input_required"; approvalId: ApprovalId }
  | {
      status: "answered";
      approvalId: ApprovalId;
      answers: AskAnswerItem[];
      /** 시간 초과로 추천 항목을 고른 경우 참 */
      defaulted: boolean;
    }
  | { status: "cancelled"; approvalId: ApprovalId; reason: AskCancelReason };
const askOutputShape = Type.Union([
  Type.Object(
    { status: Type.Literal("input_required"), approvalId: ApprovalIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("answered"),
      approvalId: ApprovalIdSchema,
      answers: Type.Array(AskAnswerItemSchema),
      defaulted: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("cancelled"),
      approvalId: ApprovalIdSchema,
      reason: Type.Union([
        Type.Literal("timeout"),
        Type.Literal("dismissed"),
        Type.Literal("aborted"),
      ]),
    },
    { additionalProperties: false },
  ),
]);
export const AskOutput: TUnsafe<AskResult> = Type.Unsafe<AskResult>(
  askOutputShape satisfies SchemaSound<AskResult, typeof askOutputShape>,
);

/** 승인 요청의 대상(subject) 내용. 승인 kind = "question" */
export type AskApprovalSubject = {
  questions: AskQuestion[];
  /** 이 질문 묶음의 답을 검사하는 JSON Schema(buildAskAnswerSchema 결과). 응답 검사에 쓴다 */
  answerSchema: Record<string, JsonValue>;
};
const askApprovalSubjectShape = Type.Object(
  {
    questions: Type.Array(AskQuestionSchema, { minItems: 1, maxItems: 4 }),
    answerSchema: Type.Record(Type.String(), JsonValueSchema),
  },
  { additionalProperties: false },
);
export const AskApprovalSubjectSchema: TUnsafe<AskApprovalSubject> =
  Type.Unsafe<AskApprovalSubject>(
    askApprovalSubjectShape satisfies SchemaProof<
      AskApprovalSubject,
      typeof askApprovalSubjectShape
    >,
  );

export type AskAnswerIssue =
  | { readonly code: "unknown_question"; readonly questionId: string }
  | { readonly code: "missing_answer"; readonly questionId: string }
  | { readonly code: "unknown_option"; readonly questionId: string; readonly optionId: string }
  | { readonly code: "too_many_selected"; readonly questionId: string }
  | { readonly code: "free_text_not_allowed"; readonly questionId: string }
  | { readonly code: "empty_answer"; readonly questionId: string };

/** 질문 정의 위반 검사. 순수 함수. 같은 질문 id 중복, 추천 둘 이상, 선택지 id 중복이면 문자열 이슈 목록을 낸다 */
export function checkAskQuestions(questions: readonly AskQuestion[]): readonly string[] {
  const issues: string[] = [];
  const seenQuestions = new Set<string>();
  for (const q of questions) {
    if (seenQuestions.has(q.id)) issues.push(`질문 id가 겹친다: ${q.id}`);
    seenQuestions.add(q.id);
    const options = q.options ?? [];
    const seenOptions = new Set<string>();
    for (const o of options) {
      if (seenOptions.has(o.id)) issues.push(`질문 ${q.id}의 선택지 id가 겹친다: ${o.id}`);
      seenOptions.add(o.id);
    }
    const recommended = options.filter((o) => o.recommended === true).length;
    if (recommended > 1) issues.push(`질문 ${q.id}의 추천 항목이 둘 이상이다`);
    if (options.length === 0 && q.allowFreeText === false) {
      issues.push(`질문 ${q.id}는 선택지가 없는데 자유 입력을 막았다`);
    }
  }
  return issues;
}

/**
 * 답이 질문 묶음에 맞는지 검사한다(§4.1.5). 순수 함수. 빈 배열이면 통과.
 * 이슈 순서: 질문 목록에 없거나 이미 답한 질문 id(`unknown_question`, 답 항목 순서), 그다음 질문 순서대로 질문마다
 * 답 없음, 선택지, 개수, 자유 입력, 빈 답 순이다. 같은 질문 id의 두 번째 이후 항목도 `unknown_question`이다.
 */
export function validateAskAnswer(
  questions: readonly AskQuestion[],
  answer: AskAnswer,
): readonly AskAnswerIssue[] {
  const issues: AskAnswerIssue[] = [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answered = new Map<string, AskAnswerItem>();
  for (const item of answer.answers) {
    if (!byId.has(item.questionId) || answered.has(item.questionId)) {
      issues.push({ code: "unknown_question", questionId: item.questionId });
    } else {
      answered.set(item.questionId, item);
    }
  }
  for (const q of questions) {
    const item = answered.get(q.id);
    if (item === undefined) {
      issues.push({ code: "missing_answer", questionId: q.id });
      continue;
    }
    const options = q.options ?? [];
    const known = new Set(options.map((o) => o.id));
    for (const optionId of item.selected) {
      if (!known.has(optionId)) issues.push({ code: "unknown_option", questionId: q.id, optionId });
    }
    if (options.length > 0 && q.multiSelect !== true && item.selected.length > 1) {
      issues.push({ code: "too_many_selected", questionId: q.id });
    }
    const hasText = item.text !== null;
    if (options.length === 0) {
      // 선택지 없는 질문은 text가 있어야 한다
      if (!hasText) issues.push({ code: "empty_answer", questionId: q.id });
    } else if (q.allowFreeText === false) {
      if (hasText) issues.push({ code: "free_text_not_allowed", questionId: q.id });
      if (item.selected.length === 0) issues.push({ code: "empty_answer", questionId: q.id });
    } else if (item.selected.length === 0 && !hasText) {
      issues.push({ code: "empty_answer", questionId: q.id });
    }
  }
  return issues;
}

/**
 * 질문 묶음에서 답 JSON Schema를 만든다(선택지 id enum, 다중 선택 maxItems, 질문 id 고정 순서). 순수 함수.
 * 의미 검사 전체는 validateAskAnswer이고, 이 스키마는 JSON Schema로 표현되는 부분만 담는다.
 */
export function buildAskAnswerSchema(questions: readonly AskQuestion[]): TSchema {
  const items = questions.map((q) => {
    const options = q.options ?? [];
    const selected =
      options.length === 0
        ? Type.Array(Type.String(), { maxItems: 0 })
        : Type.Array(Type.Union(options.map((o) => Type.Literal(o.id))), {
            maxItems: q.multiSelect === true ? options.length : 1,
            uniqueItems: true,
          });
    const freeText = options.length === 0 || q.allowFreeText !== false;
    return Type.Object(
      {
        questionId: Type.Literal(q.id),
        selected,
        text: freeText
          ? Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()])
          : Type.Null(),
      },
      { additionalProperties: false },
    );
  });
  return Type.Object({ answers: Type.Tuple(items) }, { additionalProperties: false });
}

/** 모든 질문에 추천 항목이 있으면 그 항목으로 답을 만들고, 아니면 null. 순수 함수 */
export function defaultAskAnswer(questions: readonly AskQuestion[]): AskAnswer | null {
  if (questions.length === 0) return null;
  const answers: AskAnswerItem[] = [];
  for (const q of questions) {
    const recommended = (q.options ?? []).filter((o) => o.recommended === true);
    const [only] = recommended;
    if (recommended.length !== 1 || only === undefined) return null;
    answers.push({ questionId: q.id, selected: [only.id], text: null });
  }
  return { answers };
}

function answerLine(item: AskAnswerItem): string {
  const parts: string[] = [];
  if (item.selected.length > 0) parts.push(`선택: ${item.selected.join(", ")}`);
  if (item.text !== null) parts.push(`직접 입력: ${item.text}`);
  return `${item.questionId}: ${parts.length > 0 ? parts.join(" / ") : "(답 없음)"}`;
}

/** ask_user 결과의 모델용 문장. 순수 함수 */
export function renderAsk(out: AskResult): ToolContent {
  let text: string;
  if (out.status === "input_required") {
    text = "사용자의 답을 기다리는 중이다.";
  } else if (out.status === "answered") {
    const head = out.defaulted ? "시간 초과로 추천 항목이 선택되었다." : "사용자가 답했다.";
    text = [head, ...out.answers.map(answerLine)].join("\n");
  } else if (out.reason === "timeout") {
    text = "시간 초과로 질문이 취소되었다. 사용자의 답이 없다.";
  } else if (out.reason === "dismissed") {
    text = "사용자가 질문을 닫았다. 답이 없다.";
  } else {
    text = "턴이 중단되어 질문이 취소되었다.";
  }
  return { content: [{ type: "text", text }], structuredContent: out };
}

type AskMethods = {
  readonly ask: MethodDef<typeof AskInput, typeof AskOutput>;
};

const AskIssuesDetail = Type.Object({ issues: Type.Array(Type.String()) });

export const DialogAsk: CapabilityDef<
  AskMethods,
  readonly [ToolSpec<"ask", typeof AskParams, AskMethods["ask"]>]
> = defineCapability({
  id: "dialog.ask",
  version: "1.0.0",
  description:
    "모델이나 그룹 코드가 사용자에게 질문하고 답을 받는다. 답은 승인 프로토콜(kind question)로 받는다.",
  service: {
    methods: {
      ask: {
        description: "질문 묶음을 사용자에게 보내고 답을 받는다.",
        input: AskInput,
        output: AskOutput,
        replay: "safe",
        errors: {
          ask_invalid_questions: {
            description: "질문 정의가 규칙(checkAskQuestions)을 어김",
            retryable: false,
            detail: AskIssuesDetail,
          },
          ask_unavailable_headless: {
            description: "답할 클라이언트가 없는 실행(비대화형)에서 질문함",
            retryable: false,
          },
        },
      },
    },
  },
  tools: [
    {
      name: "ask_user",
      label: "사용자에게 질문",
      description:
        "요구가 모호해 추측해야 할 때 사용자에게 1~4개 질문을 한다. 선택지를 주면 2~8개로 하고, 가장 무난한 항목에 recommended를 표시한다. " +
        "답이 오면 그 답으로 계속한다. 사용자가 답하지 않거나 취소하면 그 사실이 결과로 온다.",
      method: "ask",
      parameters: AskParams,
      toInput: (p) => ({ ...p, wait: false }),
      toContent: renderAsk,
      outputSchema: AskOutput,
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const DialogAskKey: ServiceKey<CapabilityApi<typeof DialogAsk>> = serviceKey(DialogAsk);

// ── dialog.commands (§3.2) ─────────────────────────────────────────────

export const COMMAND_NAME_PATTERN: string = "^[a-z][a-z0-9-]{0,47}(:[a-z][a-z0-9-]{0,47})?$";
export const CommandNameSchema: TString = Type.String({ pattern: COMMAND_NAME_PATTERN });

export const CommandSourceSchema: TUnion<
  [
    // L4 클라이언트 고유 명령(/model, /resume 등)
    TLiteral<"builtin">,
    // L2·L3 코드가 등록
    TLiteral<"capability">,
    // 프로젝트 명령 파일
    TLiteral<"project">,
    // 사용자 명령 파일
    TLiteral<"user">,
    // 확장 매니페스트 components.commands 파일
    TLiteral<"extension">,
  ]
> = Type.Union([
  Type.Literal("builtin"),
  Type.Literal("capability"),
  Type.Literal("project"),
  Type.Literal("user"),
  Type.Literal("extension"),
]);
export type CommandSource = Static<typeof CommandSourceSchema>;

/** 자동완성용 인자 선언. 치환 규칙과 별개로 클라이언트에 알려 주는 정보다 */
export type CommandArg = {
  name: string;
  description?: string;
  required?: boolean;
  /** 고를 수 있는 값. 있으면 자동완성 목록이 된다 */
  choices?: string[];
  /** 참이면 남은 모든 인자를 받는다(마지막 인자만) */
  rest?: boolean;
};
const commandArgShape = Type.Object(
  {
    name: Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}$" }),
    description: Type.Optional(Type.String({ maxLength: 200 })),
    required: Type.Optional(Type.Boolean()),
    choices: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 32 })),
    rest: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const CommandArgSchema: TUnsafe<CommandArg> = Type.Unsafe<CommandArg>(
  commandArgShape satisfies SchemaProof<CommandArg, typeof commandArgShape>,
);

export type CommandInfo = {
  name: string;
  description: string;
  argumentHint: string | null;
  args: CommandArg[];
  kind: "template" | "action";
  source: CommandSource;
  /** 등록 주체(확장 이름이나 파일 경로). 표시용 */
  origin: string;
  /** 템플릿 본문에 셸 주입이 있는지 */
  hasShell: boolean;
};
const commandInfoShape = Type.Object(
  {
    name: CommandNameSchema,
    description: Type.String({ maxLength: 200 }),
    argumentHint: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
    args: Type.Array(CommandArgSchema, { maxItems: 16 }),
    kind: Type.Union([Type.Literal("template"), Type.Literal("action")]),
    source: CommandSourceSchema,
    origin: Type.String({ maxLength: 512 }),
    hasShell: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const CommandInfoSchema: TUnsafe<CommandInfo> = Type.Unsafe<CommandInfo>(
  commandInfoShape satisfies SchemaProof<CommandInfo, typeof commandInfoShape>,
);

export type CommandRegisterInputValue = {
  name: string;
  description: string;
  argumentHint?: string;
  args?: CommandArg[];
  /** 템플릿 본문. pi 치환 문법(§4.2.2) */
  template: string;
  /** 등록 주체 이름(확장 이름). 예: "<그룹 이름>" */
  origin: string;
};
const commandRegisterInputShape = Type.Object(
  {
    name: CommandNameSchema,
    description: Type.String({ minLength: 1, maxLength: 200 }),
    argumentHint: Type.Optional(Type.String({ maxLength: 120 })),
    args: Type.Optional(Type.Array(CommandArgSchema, { maxItems: 16 })),
    template: Type.String({ minLength: 1, maxLength: 32768 }),
    origin: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export const CommandRegisterInput: TUnsafe<CommandRegisterInputValue> =
  Type.Unsafe<CommandRegisterInputValue>(
    commandRegisterInputShape satisfies SchemaProof<
      CommandRegisterInputValue,
      typeof commandRegisterInputShape
    >,
  );

export type CommandRegisterOutputValue = { command: CommandInfo };
const commandRegisterOutputShape = Type.Object({ command: CommandInfoSchema });
export const CommandRegisterOutput: TUnsafe<CommandRegisterOutputValue> =
  Type.Unsafe<CommandRegisterOutputValue>(
    commandRegisterOutputShape satisfies SchemaProof<
      CommandRegisterOutputValue,
      typeof commandRegisterOutputShape
    >,
  );

export type CommandListInputValue = { prefix?: string; includeHidden?: boolean };
const commandListInputShape = Type.Object(
  {
    prefix: Type.Optional(Type.String({ maxLength: 48 })),
    includeHidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const CommandListInput: TUnsafe<CommandListInputValue> = Type.Unsafe<CommandListInputValue>(
  commandListInputShape satisfies SchemaProof<CommandListInputValue, typeof commandListInputShape>,
);

export type CommandListOutputValue = { commands: CommandInfo[] };
const commandListOutputShape = Type.Object({ commands: Type.Array(CommandInfoSchema) });
export const CommandListOutput: TUnsafe<CommandListOutputValue> =
  Type.Unsafe<CommandListOutputValue>(
    commandListOutputShape satisfies SchemaProof<
      CommandListOutputValue,
      typeof commandListOutputShape
    >,
  );

export type CommandExpandInputValue = { text: string };
const commandExpandInputShape = Type.Object(
  { text: Type.String({ minLength: 1, maxLength: 65536 }) },
  { additionalProperties: false },
);
export const CommandExpandInput: TUnsafe<CommandExpandInputValue> =
  Type.Unsafe<CommandExpandInputValue>(
    commandExpandInputShape satisfies SchemaProof<
      CommandExpandInputValue,
      typeof commandExpandInputShape
    >,
  );

export type ShellInjection = { index: number; command: string };
const shellInjectionShape = Type.Object(
  { index: Type.Integer({ minimum: 0 }), command: Type.String({ maxLength: 4096 }) },
  { additionalProperties: false },
);
export const ShellInjectionSchema: TUnsafe<ShellInjection> = Type.Unsafe<ShellInjection>(
  shellInjectionShape satisfies SchemaProof<ShellInjection, typeof shellInjectionShape>,
);

export type CommandExpandOutputValue =
  | { matched: false }
  | {
      matched: true;
      name: string;
      kind: "template";
      args: string[];
      /** 셸 주입을 실행하기 전의 치환 결과. 셸 자리는 그대로 남는다 */
      text: string;
      shell: ShellInjection[];
    }
  | { matched: true; name: string; kind: "action"; args: string[] };
const commandExpandOutputShape = Type.Union([
  Type.Object({ matched: Type.Literal(false) }, { additionalProperties: false }),
  Type.Object(
    {
      matched: Type.Literal(true),
      name: CommandNameSchema,
      kind: Type.Literal("template"),
      args: Type.Array(Type.String()),
      text: Type.String(),
      shell: Type.Array(ShellInjectionSchema, { maxItems: 16 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      matched: Type.Literal(true),
      name: CommandNameSchema,
      kind: Type.Literal("action"),
      args: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
]);
export const CommandExpandOutput: TUnsafe<CommandExpandOutputValue> =
  Type.Unsafe<CommandExpandOutputValue>(
    commandExpandOutputShape satisfies SchemaSound<
      CommandExpandOutputValue,
      typeof commandExpandOutputShape
    >,
  );

export type CommandRunInputValue = {
  text: string;
  /** 셸 주입 실행을 사용자가 확인했는지 */
  confirmShell?: boolean;
};
const commandRunInputShape = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 65536 }),
    confirmShell: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const CommandRunInput: TUnsafe<CommandRunInputValue> = Type.Unsafe<CommandRunInputValue>(
  commandRunInputShape satisfies SchemaProof<CommandRunInputValue, typeof commandRunInputShape>,
);

export type CommandRunOutputValue =
  | { status: "not_command" }
  /** 사용자 입력으로 보낼 최종 텍스트 */
  | { status: "expanded"; name: string; text: string }
  /** 셸 주입이 있어 확인이 필요함. confirmShell: true로 다시 부른다 */
  | { status: "needs_confirmation"; name: string; shell: ShellInjection[] }
  /** 동작 명령의 처리 결과 */
  | { status: "done"; name: string; message: string | null; result: JsonValue };
const commandRunOutputShape = Type.Union([
  Type.Object({ status: Type.Literal("not_command") }, { additionalProperties: false }),
  Type.Object(
    { status: Type.Literal("expanded"), name: CommandNameSchema, text: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("needs_confirmation"),
      name: CommandNameSchema,
      shell: Type.Array(ShellInjectionSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("done"),
      name: CommandNameSchema,
      message: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
      result: JsonValueSchema,
    },
    { additionalProperties: false },
  ),
]);
export const CommandRunOutput: TUnsafe<CommandRunOutputValue> = Type.Unsafe<CommandRunOutputValue>(
  commandRunOutputShape satisfies SchemaSound<CommandRunOutputValue, typeof commandRunOutputShape>,
);

const COMMAND_ERRORS = {
  command_name_taken: { description: "같은 출처 등급에 같은 이름이 이미 있다", retryable: false },
  command_args_invalid: {
    description: "동작 명령 인자가 선언(args)에 맞지 않는다",
    retryable: false,
    detail: Type.Object({ message: Type.String() }),
  },
  command_shell_disabled: {
    description: "설정이 셸 주입을 끔(l2.dialog.commands.shellInjection = off)",
    retryable: false,
  },
} as const;

type CommandsMethods = {
  readonly register: MethodDef<typeof CommandRegisterInput, typeof CommandRegisterOutput>;
  readonly list: MethodDef<typeof CommandListInput, typeof CommandListOutput>;
  readonly expand: MethodDef<typeof CommandExpandInput, typeof CommandExpandOutput>;
  readonly run: MethodDef<typeof CommandRunInput, typeof CommandRunOutput>;
};

/** 모델 도구가 없는 능력이다. 모델은 명령을 호출하지 않는다. 목록은 광고만 한다(§4.2.5) */
export const DialogCommands: CapabilityDef<CommandsMethods, readonly []> = defineCapability({
  id: "dialog.commands",
  version: "1.0.0",
  description: "슬래시 명령과 프롬프트 템플릿. 모델은 명령을 호출하지 않는다.",
  service: {
    methods: {
      register: {
        description: "템플릿 명령을 등록한다.",
        input: CommandRegisterInput,
        output: CommandRegisterOutput,
        replay: "safe",
        errors: COMMAND_ERRORS,
      },
      list: {
        description: "명령 목록과 인자 선언을 돌려준다.",
        input: CommandListInput,
        output: CommandListOutput,
        replay: "safe",
      },
      expand: {
        description: "입력이 명령이면 치환 결과를 돌려준다. 아무것도 실행하지 않는다.",
        input: CommandExpandInput,
        output: CommandExpandOutput,
        replay: "safe",
        errors: COMMAND_ERRORS,
      },
      run: {
        description: "명령을 실행한다. 템플릿은 최종 텍스트를, 동작 명령은 처리기 결과를 돌려준다.",
        input: CommandRunInput,
        output: CommandRunOutput,
        replay: "unsafe",
        errors: COMMAND_ERRORS,
      },
    },
  },
  tools: [],
});
export const DialogCommandsKey: ServiceKey<CapabilityApi<typeof DialogCommands>> =
  serviceKey(DialogCommands);

/** 동작 명령 등록은 함수(처리기)를 넘기므로 JSON 메서드로 표현할 수 없다. cap:dialog.commands 바인딩의 API 객체에 TS 메서드로 더한다 */
export interface CommandActionContext {
  readonly threadId: ThreadId;
  /** 명령 입력의 멱등 키. 클라이언트 입력 키에서 파생한다 */
  readonly requestId: string;
  readonly signal: AbortSignal;
}
export interface CommandActionResult {
  readonly message: string | null;
  readonly result?: JsonValue;
}
export interface CommandActionDecl {
  /** COMMAND_NAME_PATTERN */
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly args?: readonly CommandArg[];
  readonly origin: string;
}
export type CommandActionHandler = (
  args: readonly string[],
  ctx: CommandActionContext,
) => Promise<CommandActionResult>;

export interface CommandActionRegistry {
  /** 동작 명령을 등록한다. 반환 함수로 해제한다. 이름 충돌은 CapabilityError(command_name_taken) */
  registerAction(decl: CommandActionDecl, handler: CommandActionHandler): () => void;
}

// ── dialog.status (§3.3) ───────────────────────────────────────────────

/** "core.turn", "<그룹 이름>.phase" 같은 "<소유자>.<이름>" */
export const STATUS_ITEM_ID_PATTERN: string = "^[a-z][a-z0-9-]{0,31}\\.[a-z][a-z0-9-]{0,31}$";

export type StatusItem = {
  id: string;
  text: string;
  tone?: "normal" | "busy" | "warn" | "error";
  /** 작을수록 앞. 생략하면 500 */
  order?: number;
};
const statusItemShape = Type.Object(
  {
    id: Type.String({ pattern: STATUS_ITEM_ID_PATTERN }),
    text: Type.String({ maxLength: 120 }),
    tone: Type.Optional(
      Type.Union([
        Type.Literal("normal"),
        Type.Literal("busy"),
        Type.Literal("warn"),
        Type.Literal("error"),
      ]),
    ),
    order: Type.Optional(Type.Integer({ minimum: 0, maximum: 999 })),
  },
  { additionalProperties: false },
);
export const StatusItemSchema: TUnsafe<StatusItem> = Type.Unsafe<StatusItem>(
  statusItemShape satisfies SchemaProof<StatusItem, typeof statusItemShape>,
);

export type StatusClearInputValue = { id: string };
const statusClearInputShape = Type.Object(
  { id: Type.String({ pattern: STATUS_ITEM_ID_PATTERN }) },
  { additionalProperties: false },
);
export const StatusClearInput: TUnsafe<StatusClearInputValue> = Type.Unsafe<StatusClearInputValue>(
  statusClearInputShape satisfies SchemaProof<StatusClearInputValue, typeof statusClearInputShape>,
);

export type StatusListOutputValue = { items: StatusItem[] };
const statusListOutputShape = Type.Object({ items: Type.Array(StatusItemSchema) });
export const StatusListOutput: TUnsafe<StatusListOutputValue> = Type.Unsafe<StatusListOutputValue>(
  statusListOutputShape satisfies SchemaProof<StatusListOutputValue, typeof statusListOutputShape>,
);

type StatusMethods = {
  readonly setItem: MethodDef<typeof StatusItemSchema, typeof EmptyOutput>;
  readonly clearItem: MethodDef<typeof StatusClearInput, typeof EmptyOutput>;
  readonly list: MethodDef<typeof EmptyInput, typeof StatusListOutput>;
};

/** 모델 도구가 없는 능력이다 */
export const DialogStatus: CapabilityDef<StatusMethods, readonly []> = defineCapability({
  id: "dialog.status",
  version: "1.0.0",
  description: "상태줄 세그먼트 등록. 변경은 휘발 이벤트 dialog.status로만 나간다.",
  service: {
    methods: {
      setItem: {
        description: "세그먼트를 만들거나 바꾼다.",
        input: StatusItemSchema,
        output: EmptyOutput,
        replay: "safe",
      },
      clearItem: {
        description: "세그먼트를 지운다.",
        input: StatusClearInput,
        output: EmptyOutput,
        replay: "safe",
      },
      list: {
        description: "현재 세그먼트 전체(재접속 뒤 다시 그리기용).",
        input: EmptyInput,
        output: StatusListOutput,
        replay: "safe",
      },
    },
  },
  tools: [],
});
export const DialogStatusKey: ServiceKey<CapabilityApi<typeof DialogStatus>> =
  serviceKey(DialogStatus);

// ── dialog.attachments (§3.4) ──────────────────────────────────────────

export type AttachmentSource =
  /** 로컬 파일 경로(드래그 앤 드롭, @경로) */
  | { kind: "path"; path: string }
  /** 붙여넣은 바이트(클립보드 이미지). base64 */
  | { kind: "data"; data: string; mime: string; name?: string }
  | { kind: "url"; url: string };
const attachmentSourceShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("path"), path: Type.String({ minLength: 1, maxLength: 4096 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("data"),
      data: Type.String({ minLength: 1 }),
      mime: Type.String({ minLength: 1, maxLength: 128 }),
      name: Type.Optional(Type.String({ maxLength: 255 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("url"),
      url: Type.String({ minLength: 1, maxLength: 4096, pattern: "^https?://" }),
    },
    { additionalProperties: false },
  ),
]);
export const AttachmentSourceSchema: TUnsafe<AttachmentSource> = Type.Unsafe<AttachmentSource>(
  attachmentSourceShape satisfies SchemaSound<AttachmentSource, typeof attachmentSourceShape>,
);

export type Attachment = {
  kind: "image" | "text" | "file" | "url";
  name: string;
  mime: string | null;
  size: number | null;
  /** 바이트를 저장했으면 그 참조(sys_blobs). url과 큰 파일 참조는 null */
  blob: Static<typeof ImageBlobRefSchema> | null;
  path: string | null;
  url: string | null;
  image: { width: number; height: number; resized: boolean } | null;
};
const attachmentShape = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("image"),
      Type.Literal("text"),
      Type.Literal("file"),
      Type.Literal("url"),
    ]),
    name: Type.String({ maxLength: 255 }),
    mime: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    size: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    blob: Type.Union([ImageBlobRefSchema, Type.Null()]),
    path: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    url: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    image: Type.Union([
      Type.Object({
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
        resized: Type.Boolean(),
      }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export const AttachmentSchema: TUnsafe<Attachment> = Type.Unsafe<Attachment>(
  attachmentShape satisfies SchemaProof<Attachment, typeof attachmentShape>,
);

export type AttachmentAddInputValue = { source: AttachmentSource };
const attachmentAddInputShape = Type.Object(
  { source: AttachmentSourceSchema },
  { additionalProperties: false },
);
export const AttachmentAddInput: TUnsafe<AttachmentAddInputValue> =
  Type.Unsafe<AttachmentAddInputValue>(
    attachmentAddInputShape satisfies SchemaProof<
      AttachmentAddInputValue,
      typeof attachmentAddInputShape
    >,
  );

export type AttachmentAddOutputValue = {
  attachment: Attachment;
  /** 사용자 입력(turn.start input)에 그대로 넣을 파트 */
  parts: (TextContent | ImageContent)[];
};
const attachmentAddOutputShape = Type.Object(
  {
    attachment: AttachmentSchema,
    parts: Type.Array(Type.Union([TextContentSchema, ImageContentSchema]), {
      minItems: 1,
      maxItems: 2,
    }),
  },
  { additionalProperties: false },
);
export const AttachmentAddOutput: TUnsafe<AttachmentAddOutputValue> =
  Type.Unsafe<AttachmentAddOutputValue>(
    attachmentAddOutputShape satisfies SchemaProof<
      AttachmentAddOutputValue,
      typeof attachmentAddOutputShape
    >,
  );

type AttachmentsMethods = {
  readonly add: MethodDef<typeof AttachmentAddInput, typeof AttachmentAddOutput>;
};

/** 모델 도구가 없는 능력이다 */
export const DialogAttachments: CapabilityDef<AttachmentsMethods, readonly []> = defineCapability({
  id: "dialog.attachments",
  version: "1.0.0",
  description: "이미지, 파일, URL을 사용자 입력에 붙인다. 큰 바이너리는 blob 참조로 저장한다.",
  requires: ["workspace.images"],
  service: {
    methods: {
      add: {
        description: "첨부 하나를 검사하고 저장한 뒤 입력 파트를 만든다.",
        input: AttachmentAddInput,
        output: AttachmentAddOutput,
        replay: "safe",
        errors: {
          attachment_too_large: {
            description: "l2.dialog.attachments.maxBytes 초과",
            retryable: false,
            detail: Type.Object({ size: Type.Integer(), limit: Type.Integer() }),
          },
          attachment_type_unsupported: { description: "읽을 수 없는 형식", retryable: false },
        },
      },
    },
  },
  tools: [],
});
export const DialogAttachmentsKey: ServiceKey<CapabilityApi<typeof DialogAttachments>> =
  serviceKey(DialogAttachments);

// ── dialog.aside, dialog.styles (§3.5, 2차) ────────────────────────────

export type AsideAskInputValue = { question: string };
const asideAskInputShape = Type.Object(
  { question: Type.String({ minLength: 1, maxLength: 8000 }) },
  { additionalProperties: false },
);
export const AsideAskInput: TUnsafe<AsideAskInputValue> = Type.Unsafe<AsideAskInputValue>(
  asideAskInputShape satisfies SchemaProof<AsideAskInputValue, typeof asideAskInputShape>,
);

export type AsideAskOutputValue = {
  answer: string;
  /** 곁가지 모델 호출 사용량. 본류 기록에는 들어가지 않는다 */
  usage: { inputTokens: number; outputTokens: number } | null;
};
const asideAskOutputShape = Type.Object(
  {
    answer: Type.String(),
    usage: Type.Union([
      Type.Object({ inputTokens: Type.Integer(), outputTokens: Type.Integer() }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export const AsideAskOutput: TUnsafe<AsideAskOutputValue> = Type.Unsafe<AsideAskOutputValue>(
  asideAskOutputShape satisfies SchemaProof<AsideAskOutputValue, typeof asideAskOutputShape>,
);

type AsideMethods = {
  readonly ask: MethodDef<typeof AsideAskInput, typeof AsideAskOutput>;
};

/** 2차. 모델 도구가 없는 능력이다 */
export const DialogAside: CapabilityDef<AsideMethods, readonly []> = defineCapability({
  id: "dialog.aside",
  version: "1.0.0",
  description: "본류 컨텍스트를 읽기만 하는 별도 질문. 본류 기록을 바꾸지 않는다.",
  service: {
    methods: {
      ask: {
        description: "본류 스냅숏을 읽고 별도 모델 호출로 답한다.",
        input: AsideAskInput,
        output: AsideAskOutput,
        replay: "safe",
      },
    },
  },
  tools: [],
});
export const DialogAsideKey: ServiceKey<CapabilityApi<typeof DialogAside>> =
  serviceKey(DialogAside);

export const StyleIdSchema: TString = Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}$" });

export type Style = {
  id: string;
  name: string;
  description: string;
  /** 시스템 프롬프트에 붙는 조각 */
  prompt: string;
  origin: string;
};
const styleShape = Type.Object(
  {
    id: StyleIdSchema,
    name: Type.String({ minLength: 1, maxLength: 64 }),
    description: Type.String({ maxLength: 300 }),
    prompt: Type.String({ maxLength: 8192 }),
    origin: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false },
);
export const StyleSchema: TUnsafe<Style> = Type.Unsafe<Style>(
  styleShape satisfies SchemaProof<Style, typeof styleShape>,
);

export type StyleSelectInputValue = { id: string | null };
const styleSelectInputShape = Type.Object(
  { id: Type.Union([StyleIdSchema, Type.Null()]) },
  { additionalProperties: false },
);
export const StyleSelectInput: TUnsafe<StyleSelectInputValue> = Type.Unsafe<StyleSelectInputValue>(
  styleSelectInputShape satisfies SchemaProof<StyleSelectInputValue, typeof styleSelectInputShape>,
);

export type StyleSelectOutputValue = { active: string; appliesAt: "next_turn" };
const styleSelectOutputShape = Type.Object({
  active: StyleIdSchema,
  appliesAt: Type.Literal("next_turn"),
});
export const StyleSelectOutput: TUnsafe<StyleSelectOutputValue> =
  Type.Unsafe<StyleSelectOutputValue>(
    styleSelectOutputShape satisfies SchemaProof<
      StyleSelectOutputValue,
      typeof styleSelectOutputShape
    >,
  );

type StylesMethods = {
  readonly register: MethodDef<typeof StyleSchema, typeof EmptyOutput>;
  readonly select: MethodDef<typeof StyleSelectInput, typeof StyleSelectOutput>;
};

/** 2차. 모델 도구가 없는 능력이다 */
export const DialogStyles: CapabilityDef<StylesMethods, readonly []> = defineCapability({
  id: "dialog.styles",
  version: "1.0.0",
  description: "세션 단위 출력 스타일. 적용은 다음 턴 시작이다.",
  service: {
    methods: {
      register: {
        description: "스타일을 등록한다.",
        input: StyleSchema,
        output: EmptyOutput,
        replay: "safe",
      },
      select: {
        description: "이 세션의 스타일을 고른다. null은 기본 스타일.",
        input: StyleSelectInput,
        output: StyleSelectOutput,
        replay: "safe",
        errors: { style_unknown: { description: "등록되지 않은 스타일", retryable: false } },
      },
    },
  },
  tools: [],
});
export const DialogStylesKey: ServiceKey<CapabilityApi<typeof DialogStyles>> =
  serviceKey(DialogStyles);

// ── dialog.notify (§3.6) ───────────────────────────────────────────────

export const NoticeKindSchema: TUnion<
  [
    // 턴·목표가 끝나 사용자 차례
    TLiteral<"completed">,
    // 도구·계획 승인 대기(입력 필요)
    TLiteral<"approval_waiting">,
    // 질문 대기(입력 필요)
    TLiteral<"question_waiting">,
    // 턴 실패, 판정 실패 등
    TLiteral<"error">,
    // 백그라운드 위임·서브에이전트 완료
    TLiteral<"background_completed">,
  ]
> = Type.Union([
  Type.Literal("completed"),
  Type.Literal("approval_waiting"),
  Type.Literal("question_waiting"),
  Type.Literal("error"),
  Type.Literal("background_completed"),
]);
export type NoticeKind = Static<typeof NoticeKindSchema>;
export const INPUT_NEEDED_KINDS: readonly NoticeKind[] = ["approval_waiting", "question_waiting"];

export type Notice = {
  kind: NoticeKind;
  title: string;
  body: string | null;
  /** 이 알림을 만든 내구 이벤트의 seq */
  seq: number;
  /** 파생 알림이면 원인 이벤트 type, emit이면 "dialog.notified" */
  sourceType: string;
};
const noticeShape = Type.Object(
  {
    kind: NoticeKindSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    body: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
    seq: Type.Integer({ minimum: 1 }),
    sourceType: Type.String({ maxLength: 128 }),
  },
  { additionalProperties: false },
);
export const NoticeSchema: TUnsafe<Notice> = Type.Unsafe<Notice>(
  noticeShape satisfies SchemaProof<Notice, typeof noticeShape>,
);

export type NotifyEmitInputValue = {
  kind: NoticeKind;
  title: string;
  body?: string;
  origin: string;
};
const notifyEmitInputShape = Type.Object(
  {
    kind: NoticeKindSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    body: Type.Optional(Type.String({ maxLength: 1000 })),
    origin: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export const NotifyEmitInput: TUnsafe<NotifyEmitInputValue> = Type.Unsafe<NotifyEmitInputValue>(
  notifyEmitInputShape satisfies SchemaProof<NotifyEmitInputValue, typeof notifyEmitInputShape>,
);

export type NotifyEmitOutputValue = { notice: Notice };
const notifyEmitOutputShape = Type.Object({ notice: NoticeSchema });
export const NotifyEmitOutput: TUnsafe<NotifyEmitOutputValue> = Type.Unsafe<NotifyEmitOutputValue>(
  notifyEmitOutputShape satisfies SchemaProof<NotifyEmitOutputValue, typeof notifyEmitOutputShape>,
);

export type NotifyListInputValue = { afterSeq: number; kinds?: NoticeKind[]; limit?: number };
const notifyListInputShape = Type.Object(
  {
    afterSeq: Type.Integer({ minimum: 0 }),
    kinds: Type.Optional(
      Type.Array(NoticeKindSchema, { minItems: 1, maxItems: 5, uniqueItems: true }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);
export const NotifyListInput: TUnsafe<NotifyListInputValue> = Type.Unsafe<NotifyListInputValue>(
  notifyListInputShape satisfies SchemaProof<NotifyListInputValue, typeof notifyListInputShape>,
);

export type NotifyListOutputValue = { notices: Notice[]; nextSeq: number };
const notifyListOutputShape = Type.Object({
  notices: Type.Array(NoticeSchema),
  nextSeq: Type.Integer(),
});
export const NotifyListOutput: TUnsafe<NotifyListOutputValue> = Type.Unsafe<NotifyListOutputValue>(
  notifyListOutputShape satisfies SchemaProof<NotifyListOutputValue, typeof notifyListOutputShape>,
);

type NotifyMethods = {
  readonly emit: MethodDef<typeof NotifyEmitInput, typeof NotifyEmitOutput>;
  readonly list: MethodDef<typeof NotifyListInput, typeof NotifyListOutput>;
};

/** 모델 도구가 없는 능력이다 */
export const DialogNotify: CapabilityDef<NotifyMethods, readonly []> = defineCapability({
  id: "dialog.notify",
  version: "1.0.0",
  description: "사용자 주의가 필요한 상태를 5종으로 분류하고 알린다.",
  service: {
    methods: {
      emit: {
        description: "그룹·플러그인이 알림을 직접 낸다(내구 기록).",
        input: NotifyEmitInput,
        output: NotifyEmitOutput,
        replay: "safe",
      },
      list: {
        description: "afterSeq 뒤의 알림을 분류해 돌려준다(당겨 읽기).",
        input: NotifyListInput,
        output: NotifyListOutput,
        replay: "safe",
      },
    },
  },
  tools: [],
});
export const DialogNotifyKey: ServiceKey<CapabilityApi<typeof DialogNotify>> =
  serviceKey(DialogNotify);

/** 같은 프로세스 소비자용 밀어주기 구독. JSON 메서드로 표현할 수 없어 dialog.notify 능력 API 객체에 TS 메서드로 둔다 */
export interface NoticeFeed {
  subscribe(
    filter: { readonly kinds?: readonly NoticeKind[] },
    listener: (threadId: ThreadId, notice: Notice) => void,
  ): () => void;
}

// ── 서비스 묶음 ────────────────────────────────────────────────────────

/** dialog 도메인 묶음 타입(L2.readme §5.6). Cordis에 등록하지 않는다. 등록은 능력마다 cap:<id> 바인딩이다 */
export interface DialogService {
  readonly ask: CapabilityApi<typeof DialogAsk>;
  readonly commands: CapabilityApi<typeof DialogCommands> & CommandActionRegistry;
  readonly status: CapabilityApi<typeof DialogStatus>;
  readonly attachments: CapabilityApi<typeof DialogAttachments>;
  readonly aside: CapabilityApi<typeof DialogAside>;
  readonly styles: CapabilityApi<typeof DialogStyles>;
  readonly notify: CapabilityApi<typeof DialogNotify> & NoticeFeed;
}
/** 묶음 이름. eng.context-map.design §5.3 표의 이름이고 Cordis 등록 이름이 아니다 */
export const DialogServiceName = "xeon.dialog" as const;
export const DIALOG_CAPABILITIES: readonly [
  typeof DialogAsk,
  typeof DialogCommands,
  typeof DialogStatus,
  typeof DialogAttachments,
  typeof DialogAside,
  typeof DialogStyles,
  typeof DialogNotify,
] = [
  DialogAsk,
  DialogCommands,
  DialogStatus,
  DialogAttachments,
  DialogAside,
  DialogStyles,
  DialogNotify,
];
