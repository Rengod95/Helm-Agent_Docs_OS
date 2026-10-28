import { describe, expect, test } from "bun:test";
import { Compile } from "typebox/compile";
import { parse } from "../../src/base/index.ts";
import {
  AskAnswerSchema,
  AskApprovalSubjectSchema,
  AskInput,
  AskOutput,
  AskParams,
  AskQuestionSchema,
  AttachmentAddInput,
  AttachmentAddOutput,
  COMMAND_NAME_PATTERN,
  CommandExpandOutput,
  CommandInfoSchema,
  CommandRunOutput,
  DIALOG_CAPABILITIES,
  DialogAsk,
  DialogAskKey,
  DialogAttachments,
  DialogCommands,
  DialogNotify,
  DialogServiceName,
  DialogStatus,
  INPUT_NEEDED_KINDS,
  NoticeKindSchema,
  NotifyListInput,
  STATUS_ITEM_ID_PATTERN,
  StatusItemSchema,
  WorkspaceImages,
  buildAskAnswerSchema,
  checkAskQuestions,
  defaultAskAnswer,
  orderTools,
  renderAsk,
  toJsonSchema,
  validateAskAnswer,
  validateCapability,
  validateCapabilitySet,
  type AnyCapabilityDef,
  type AskAnswer,
  type AskQuestion,
  type AskResult,
  type ToolContent,
} from "../../src/capabilities/index.ts";
import { ApprovalIdSchema } from "../../src/conversation/index.ts";
import { must, rawId } from "../helpers/ids.ts";
import { withoutClassWarnings } from "./helpers.ts";

function options(n: number): { id: string; label: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `O${i}` }));
}

const WORKSPACE_IMAGES: AnyCapabilityDef = WorkspaceImages;

function firstText(result: ToolContent): string {
  const first = result.content[0];
  return first !== undefined && first.type === "text" ? first.text : "";
}

const SCOPE_Q: AskQuestion = {
  id: "scope",
  header: "범위",
  question: "어디까지 고칠까요?",
  options: [
    { id: "small", label: "작게", recommended: true },
    { id: "large", label: "크게" },
  ],
};
const TAGS_Q: AskQuestion = {
  id: "tags",
  question: "붙일 태그는?",
  multiSelect: true,
  allowFreeText: false,
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B", recommended: true },
    { id: "c", label: "C" },
  ],
};
const NAME_Q: AskQuestion = { id: "name", question: "이름을 알려 주세요" };

describe("dialog definitions", () => {
  test("the seven definitions have no validation issues and the set resolves its requires", () => {
    for (const def of DIALOG_CAPABILITIES)
      expect(withoutClassWarnings(validateCapability(def))).toEqual([]);
    expect(validateCapabilitySet([...DIALOG_CAPABILITIES, WORKSPACE_IMAGES])).toEqual([]);
    expect(DIALOG_CAPABILITIES.map((d) => d.id)).toEqual([
      "dialog.ask",
      "dialog.commands",
      "dialog.status",
      "dialog.attachments",
      "dialog.aside",
      "dialog.styles",
      "dialog.notify",
    ]);
  });

  test("attachments require workspace.images and nothing else", () => {
    expect(DialogAttachments.requires).toEqual(["workspace.images"]);
    const issues = validateCapabilitySet([DialogAttachments]);
    expect(issues.map((i) => i.code)).toEqual(["requires_unresolved"]);
  });

  test("ask_user is the only dialog tool", () => {
    expect(orderTools([...DIALOG_CAPABILITIES]).map((t) => t.name)).toEqual(["ask_user"]);
    expect(DialogAskKey).toEqual({ capability: "dialog.ask", version: "1.0.0" });
    expect(DialogServiceName).toBe("xeon.dialog");
    const tool = DialogAsk.tools[0];
    expect(tool.executionMode).toBe("sequential");
    expect(tool.hints?.readOnly).toBe(true);
  });

  test("ask_user forces wait off for the model", () => {
    const params = { questions: [SCOPE_Q], timeoutSec: 60 };
    const input = DialogAsk.tools[0].toInput?.(params);
    expect(input).toEqual({ ...params, wait: false });
    expect(parse(AskInput, input).ok).toBe(true);
    expect(parse(AskParams, { ...params, wait: true }).ok).toBe(false);
  });

  test("only run is replay unsafe among the commands methods", () => {
    const methods = DialogCommands.service.methods;
    expect(methods.run.replay).toBe("unsafe");
    expect([methods.register, methods.list, methods.expand].every((m) => m.replay === "safe")).toBe(
      true,
    );
  });

  test("status and notify methods are replay safe", () => {
    for (const def of [DialogStatus, DialogNotify]) {
      for (const method of Object.values(def.service.methods)) expect(method.replay).toBe("safe");
    }
  });
});

describe("ask schemas", () => {
  test("question and option counts are bounded by the schema", () => {
    expect(parse(AskParams, { questions: [] }).ok).toBe(false);
    expect(parse(AskParams, { questions: Array.from({ length: 5 }, () => NAME_Q) }).ok).toBe(false);
    expect(parse(AskParams, { questions: Array.from({ length: 4 }, () => NAME_Q) }).ok).toBe(true);
    expect(parse(AskQuestionSchema, { id: "q", question: "?", options: options(1) }).ok).toBe(
      false,
    );
    expect(parse(AskQuestionSchema, { id: "q", question: "?", options: options(2) }).ok).toBe(true);
    expect(parse(AskQuestionSchema, { id: "q", question: "?", options: options(8) }).ok).toBe(true);
    expect(parse(AskQuestionSchema, { id: "q", question: "?", options: options(9) }).ok).toBe(
      false,
    );
    expect(parse(AskQuestionSchema, { id: "Q", question: "?" }).ok).toBe(false);
  });

  test("ask output is input_required, answered or cancelled", () => {
    const id = rawId("evt", 1);
    expect(parse(AskOutput, { status: "input_required", approvalId: id }).ok).toBe(true);
    const answered = {
      status: "answered",
      approvalId: id,
      answers: [{ questionId: "scope", selected: ["small"], text: null }],
      defaulted: true,
    };
    expect(parse(AskOutput, answered).ok).toBe(true);
    expect(parse(AskOutput, { status: "cancelled", approvalId: id, reason: "timeout" }).ok).toBe(
      true,
    );
    expect(parse(AskOutput, { status: "cancelled", approvalId: id, reason: "bored" }).ok).toBe(
      false,
    );
    expect(parse(AskOutput, { ...answered, defaulted: undefined }).ok).toBe(false);
  });

  test("an approval subject carries the questions and a JSON Schema for the answer", () => {
    const subject = {
      questions: [SCOPE_Q],
      answerSchema: toJsonSchema(buildAskAnswerSchema([SCOPE_Q])),
    };
    expect(parse(AskApprovalSubjectSchema, subject).ok).toBe(true);
    expect(parse(AskApprovalSubjectSchema, { questions: [], answerSchema: {} }).ok).toBe(false);
  });
});

describe("checkAskQuestions", () => {
  test("a clean set has no issues", () => {
    expect(checkAskQuestions([SCOPE_Q, TAGS_Q, NAME_Q])).toEqual([]);
  });

  test("reports duplicate question ids, duplicate option ids and multiple recommendations", () => {
    const dupOptions: AskQuestion = {
      id: "dup",
      question: "?",
      options: [
        { id: "x", label: "X", recommended: true },
        { id: "x", label: "X2", recommended: true },
      ],
    };
    const issues = checkAskQuestions([SCOPE_Q, { ...SCOPE_Q }, dupOptions]);
    expect(issues).toEqual([
      "질문 id가 겹친다: scope",
      "질문 dup의 선택지 id가 겹친다: x",
      "질문 dup의 추천 항목이 둘 이상이다",
    ]);
  });

  test("a free-text block needs options to choose from", () => {
    expect(checkAskQuestions([{ id: "q", question: "?", allowFreeText: false }])).toEqual([
      "질문 q는 선택지가 없는데 자유 입력을 막았다",
    ]);
  });
});

describe("validateAskAnswer", () => {
  const questions = [SCOPE_Q, TAGS_Q, NAME_Q];
  const good: AskAnswer = {
    answers: [
      { questionId: "scope", selected: ["large"], text: null },
      { questionId: "tags", selected: ["a", "c"], text: null },
      { questionId: "name", selected: [], text: "Helm" },
    ],
  };

  test("a complete answer passes", () => {
    expect(validateAskAnswer(questions, good)).toEqual([]);
  });

  test("free text alone is fine when the question allows it", () => {
    const answer: AskAnswer = {
      answers: [
        { questionId: "scope", selected: [], text: "something else" },
        ...good.answers.slice(1),
      ],
    };
    expect(validateAskAnswer(questions, answer)).toEqual([]);
  });

  test("missing, unknown and repeated question ids", () => {
    const answer: AskAnswer = {
      answers: [
        good.answers[0] ?? { questionId: "scope", selected: ["small"], text: null },
        { questionId: "ghost", selected: [], text: "x" },
        { questionId: "scope", selected: ["small"], text: null },
      ],
    };
    expect(validateAskAnswer(questions, answer)).toEqual([
      { code: "unknown_question", questionId: "ghost" },
      { code: "unknown_question", questionId: "scope" },
      { code: "missing_answer", questionId: "tags" },
      { code: "missing_answer", questionId: "name" },
    ]);
  });

  test("unknown option, too many selected, blocked free text and empty answers", () => {
    const answer: AskAnswer = {
      answers: [
        { questionId: "scope", selected: ["small", "nope"], text: null },
        { questionId: "tags", selected: [], text: "free" },
        { questionId: "name", selected: ["x"], text: null },
      ],
    };
    expect(validateAskAnswer(questions, answer)).toEqual([
      { code: "unknown_option", questionId: "scope", optionId: "nope" },
      { code: "too_many_selected", questionId: "scope" },
      { code: "free_text_not_allowed", questionId: "tags" },
      { code: "empty_answer", questionId: "tags" },
      { code: "unknown_option", questionId: "name", optionId: "x" },
      { code: "empty_answer", questionId: "name" },
    ]);
  });

  test("an empty answer on a question that allows free text is rejected", () => {
    const answer: AskAnswer = {
      answers: [{ questionId: "scope", selected: [], text: null }, ...good.answers.slice(1)],
    };
    expect(validateAskAnswer(questions, answer)).toEqual([
      { code: "empty_answer", questionId: "scope" },
    ]);
  });
});

describe("buildAskAnswerSchema", () => {
  const questions = [SCOPE_Q, TAGS_Q, NAME_Q];
  const validator = Compile(buildAskAnswerSchema(questions));
  const good: AskAnswer = {
    answers: [
      { questionId: "scope", selected: ["large"], text: null },
      { questionId: "tags", selected: ["a", "c"], text: null },
      { questionId: "name", selected: [], text: "Helm" },
    ],
  };

  test("accepts the answer validateAskAnswer accepts", () => {
    expect(validator.Check(good)).toBe(true);
  });

  test("fixes the question order", () => {
    const swapped = { answers: [good.answers[1], good.answers[0], good.answers[2]] };
    expect(validator.Check(swapped)).toBe(false);
  });

  test("limits option ids to the declared enum and single choice to one item", () => {
    const unknown = structuredClone(good);
    unknown.answers[0] = { questionId: "scope", selected: ["huge"], text: null };
    expect(validator.Check(unknown)).toBe(false);
    const two = structuredClone(good);
    two.answers[0] = { questionId: "scope", selected: ["small", "large"], text: null };
    expect(validator.Check(two)).toBe(false);
  });

  test("blocked free text must be null and option-less questions take no selection", () => {
    const text = structuredClone(good);
    text.answers[1] = { questionId: "tags", selected: ["a"], text: "free" };
    expect(validator.Check(text)).toBe(false);
    const selected = structuredClone(good);
    selected.answers[2] = { questionId: "name", selected: ["a"], text: "Helm" };
    expect(validator.Check(selected)).toBe(false);
  });

  test("is pure: the same questions give the same JSON Schema", () => {
    expect(toJsonSchema(buildAskAnswerSchema(questions))).toEqual(
      toJsonSchema(buildAskAnswerSchema(questions)),
    );
  });
});

describe("defaultAskAnswer", () => {
  test("every question needs exactly one recommended option", () => {
    expect(defaultAskAnswer([SCOPE_Q, TAGS_Q])).toEqual({
      answers: [
        { questionId: "scope", selected: ["small"], text: null },
        { questionId: "tags", selected: ["b"], text: null },
      ],
    });
    expect(defaultAskAnswer([SCOPE_Q, NAME_Q])).toBeNull();
    expect(defaultAskAnswer([])).toBeNull();
    const none: AskQuestion = {
      id: "q",
      question: "?",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    };
    expect(defaultAskAnswer([none])).toBeNull();
  });

  test("the default answer passes validation", () => {
    const answer = defaultAskAnswer([SCOPE_Q, TAGS_Q]);
    expect(answer).not.toBeNull();
    if (answer === null) return;
    expect(validateAskAnswer([SCOPE_Q, TAGS_Q], answer)).toEqual([]);
    expect(parse(AskAnswerSchema, answer).ok).toBe(true);
  });
});

describe("renderAsk", () => {
  const approvalId = must(ApprovalIdSchema, rawId("evt", 4));

  test("each status has its own sentence", () => {
    expect(firstText(renderAsk({ status: "input_required", approvalId }))).toBe(
      "사용자의 답을 기다리는 중이다.",
    );
    const answers = [
      { questionId: "scope", selected: ["small"], text: null },
      { questionId: "name", selected: [], text: "Helm" },
      { questionId: "tags", selected: ["a"], text: "also this" },
    ];
    const answered: AskResult = { status: "answered", approvalId, answers, defaulted: false };
    expect(firstText(renderAsk(answered))).toBe(
      [
        "사용자가 답했다.",
        "scope: 선택: small",
        "name: 직접 입력: Helm",
        "tags: 선택: a / 직접 입력: also this",
      ].join("\n"),
    );
    expect(firstText(renderAsk({ ...answered, defaulted: true })).split("\n")[0]).toBe(
      "시간 초과로 추천 항목이 선택되었다.",
    );
    const cancelled = (reason: "timeout" | "dismissed" | "aborted"): string =>
      firstText(renderAsk({ status: "cancelled", approvalId, reason }));
    expect(cancelled("timeout")).toContain("시간 초과");
    expect(cancelled("dismissed")).toContain("닫았다");
    expect(cancelled("aborted")).toContain("중단");
  });

  test("the result is returned as structured content unchanged", () => {
    const out: AskResult = { status: "input_required", approvalId };
    expect(renderAsk(out).structuredContent).toBe(out);
  });
});

describe("commands, status, attachments and notify schemas", () => {
  test("command names allow one optional namespace", () => {
    const regex = new RegExp(COMMAND_NAME_PATTERN);
    for (const ok of ["review", "plan:approve", "a-b:c-d"]) expect(regex.test(ok)).toBe(true);
    for (const bad of ["Review", "a:b:c", ":a", "a:", "1a"]) expect(regex.test(bad)).toBe(false);
  });

  test("a command info entry parses", () => {
    const info = {
      name: "review",
      description: "리뷰한다",
      argumentHint: "<파일>",
      args: [{ name: "file", required: true, rest: true }],
      kind: "template",
      source: "project",
      origin: ".xeon/commands/review.md",
      hasShell: false,
    };
    expect(parse(CommandInfoSchema, info).ok).toBe(true);
    expect(parse(CommandInfoSchema, { ...info, source: "plugin" }).ok).toBe(false);
  });

  test("expand and run outputs are closed unions", () => {
    expect(parse(CommandExpandOutput, { matched: false }).ok).toBe(true);
    const template = {
      matched: true,
      name: "review",
      kind: "template",
      args: ["a.ts"],
      text: "Review a.ts",
      shell: [{ index: 0, command: "git diff" }],
    };
    expect(parse(CommandExpandOutput, template).ok).toBe(true);
    expect(parse(CommandExpandOutput, { ...template, kind: "macro" }).ok).toBe(false);
    expect(parse(CommandRunOutput, { status: "not_command" }).ok).toBe(true);
    expect(
      parse(CommandRunOutput, { status: "done", name: "model", message: null, result: { id: "x" } })
        .ok,
    ).toBe(true);
    expect(parse(CommandRunOutput, { status: "done", name: "model", message: null }).ok).toBe(
      false,
    );
  });

  test("status items use <owner>.<name> ids", () => {
    const regex = new RegExp(STATUS_ITEM_ID_PATTERN);
    expect(regex.test("core.turn")).toBe(true);
    expect(regex.test("helm.phase")).toBe(true);
    expect(regex.test("core")).toBe(false);
    expect(
      parse(StatusItemSchema, { id: "core.turn", text: "작업 중", tone: "busy", order: 10 }).ok,
    ).toBe(true);
    expect(parse(StatusItemSchema, { id: "core.turn", text: "x".repeat(121) }).ok).toBe(false);
  });

  test("attachments accept path, data and url sources", () => {
    expect(parse(AttachmentAddInput, { source: { kind: "path", path: "/tmp/a.png" } }).ok).toBe(
      true,
    );
    expect(
      parse(AttachmentAddInput, { source: { kind: "data", data: "QUJD", mime: "image/png" } }).ok,
    ).toBe(true);
    expect(parse(AttachmentAddInput, { source: { kind: "url", url: "ftp://x" } }).ok).toBe(false);
    const sha = "a".repeat(64);
    const output = {
      attachment: {
        kind: "image",
        name: "a.png",
        mime: "image/png",
        size: 3,
        blob: { type: "blob", sha256: sha, size: 3, mediaType: "image/png" },
        path: null,
        url: null,
        image: { width: 10, height: 10, resized: false },
      },
      parts: [{ type: "text", text: "[이미지 a.png]" }],
    };
    expect(parse(AttachmentAddOutput, output).ok).toBe(true);
    expect(parse(AttachmentAddOutput, { ...output, parts: [] }).ok).toBe(false);
  });

  test("notice kinds and the input-needed subset", () => {
    expect(INPUT_NEEDED_KINDS).toEqual(["approval_waiting", "question_waiting"]);
    for (const kind of INPUT_NEEDED_KINDS) expect(parse(NoticeKindSchema, kind).ok).toBe(true);
    expect(parse(NoticeKindSchema, "info").ok).toBe(false);
    expect(parse(NotifyListInput, { afterSeq: 0, kinds: ["error", "completed"] }).ok).toBe(true);
    expect(parse(NotifyListInput, { afterSeq: 0, kinds: ["error", "error"] }).ok).toBe(false);
  });
});
