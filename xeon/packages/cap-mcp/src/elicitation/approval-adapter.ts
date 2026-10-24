import { assertNever, err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import type { McpQuestion } from "@xeon/contracts/capabilities";
import type { JsonObject, JsonValue, ThreadId } from "@xeon/contracts/conversation";
import type {
  ApprovalRequestError,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
  QuestionAnswer,
  QuestionBody,
} from "@xeon/contracts/services";
import { Type } from "typebox";
import { asJsonArray, asJsonObject } from "../json.ts";
import { buildInputResponses, type KeyedAnswer, type ResponseError } from "./responses.ts";

// MCP.4(D5): 서버 주도 요청을 승인 프로토콜의 kind `question` 요청으로 옮기는 규칙. L1.tools가 `McpQuestion`을
// `QuestionBody`로 옮기는 F 요청이 닫히기 전까지 이 파일이 규칙의 기준 구현이다. 그룹 코드가 `callTool`의
// `input_required` 변형을 직접 처리할 때도 쓴다(L2.mcp.spec §4.6 9번).
//
// 질문 본문은 1~4개다(QuestionBody). 폼 필드가 네 개 이하면 필드마다 질문 하나, 넘으면 폼마다 JSON 한 칸이다.

const MAX_ITEMS = 4;
const MAX_ID = 32;

type OptionSpec = { id: string; label: string };
type ItemSpec = {
  id: string;
  text: string;
  options: OptionSpec[];
  multiSelect: boolean;
  allowFreeText: boolean;
};

/** 질문 항목 하나가 어느 입력 요청의 어느 값인지 */
type ItemTarget =
  | {
      readonly kind: "field";
      readonly key: string;
      readonly field: string;
      readonly type: FieldType;
      readonly values: readonly JsonValue[];
    }
  | { readonly kind: "whole_form"; readonly key: string }
  | { readonly kind: "confirm"; readonly key: string };

type FieldType = "string" | "number" | "integer" | "boolean" | "array";

export interface PlannedQuestions {
  readonly body: QuestionBody;
  /** 승인 요청 `subject`로 보내는 같은 내용의 JSON */
  readonly subject: JsonObject;
  /** 질문 id → 대상 */
  readonly targets: ReadonlyMap<string, ItemTarget>;
  readonly questions: readonly McpQuestion[];
}

export type PlanError = { readonly kind: "too_many_questions"; readonly count: number };

function labelOf(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function enumOptions(property: JsonObject): { options: OptionSpec[]; values: JsonValue[] } {
  const values: JsonValue[] = [];
  const options: OptionSpec[] = [];
  const direct = asJsonArray(property["enum"]);
  const titled = asJsonArray(property["oneOf"]);
  const push = (value: JsonValue, label: string): void => {
    const id =
      typeof value === "string" && value.length >= 1 && value.length <= MAX_ID
        ? value
        : `o${values.length}`;
    values.push(value);
    options.push({ id, label: label.slice(0, 80) });
  };
  if (direct !== undefined) for (const value of direct) push(value, labelOf(value));
  else if (titled !== undefined) {
    for (const entry of titled) {
      const item = asJsonObject(entry);
      const value = item?.["const"];
      if (item === undefined || value === undefined) continue;
      push(value, typeof item["title"] === "string" ? item["title"] : labelOf(value));
    }
  }
  return { options, values };
}

function fieldType(property: JsonObject): FieldType {
  const type = property["type"];
  if (type === "number" || type === "integer" || type === "boolean" || type === "array")
    return type;
  return "string";
}

function fieldItem(
  id: string,
  message: string,
  name: string,
  property: JsonObject,
): { item: ItemSpec; type: FieldType; values: JsonValue[] } {
  const type = fieldType(property);
  const title = typeof property["title"] === "string" ? property["title"] : name;
  const text = `${message}\n${title}`.trim();
  if (type === "boolean") {
    return {
      type,
      values: [true, false],
      item: {
        id,
        text,
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
    };
  }
  const source = type === "array" ? (asJsonObject(property["items"]) ?? {}) : property;
  const { options, values } = enumOptions(source);
  return {
    type,
    values,
    item: { id, text, options, multiSelect: type === "array", allowFreeText: options.length === 0 },
  };
}

function formFields(
  question: Extract<McpQuestion, { kind: "elicitation_form" }>,
): [string, JsonObject][] {
  const schema = asJsonObject(question.requestedSchema);
  const properties = asJsonObject(schema?.["properties"]) ?? {};
  const fields: [string, JsonObject][] = [];
  for (const [name, value] of Object.entries(properties)) {
    const property = asJsonObject(value);
    if (property !== undefined) fields.push([name, property]);
  }
  return fields;
}

/** 질문 목록을 `QuestionBody`로 옮긴다. 질문이 너무 많으면 오류다 */
export function planQuestionBody(
  questions: readonly McpQuestion[],
): Result<PlannedQuestions, PlanError> {
  const perField = questions.reduce(
    (count, question) =>
      count + (question.kind === "elicitation_form" ? Math.max(1, formFields(question).length) : 1),
    0,
  );
  const collapse = perField > MAX_ITEMS;
  const items: ItemSpec[] = [];
  const targets = new Map<string, ItemTarget>();
  let index = 0;
  const nextId = (): string => {
    index += 1;
    return `q${index}`;
  };
  for (const question of questions) {
    if (question.kind === "elicitation_form") {
      const fields = formFields(question);
      if (collapse || fields.length === 0) {
        const id = nextId();
        items.push({
          id,
          text: `${question.message}\nAnswer with a JSON object that matches the form.`.trim(),
          options: [],
          multiSelect: false,
          allowFreeText: true,
        });
        targets.set(id, { kind: "whole_form", key: question.key });
        continue;
      }
      for (const [name, property] of fields) {
        const id = nextId();
        const built = fieldItem(id, question.message, name, property);
        items.push(built.item);
        targets.set(id, {
          kind: "field",
          key: question.key,
          field: name,
          type: built.type,
          values: built.values,
        });
      }
      continue;
    }
    const id = nextId();
    const label = question.kind === "elicitation_url" ? "Done" : "Allow";
    const text =
      question.kind === "elicitation_url"
        ? `${question.message}\nOpen ${question.url} and finish the steps there.`.trim()
        : question.summary;
    items.push({
      id,
      text,
      options: [{ id: "yes", label }],
      multiSelect: false,
      allowFreeText: false,
    });
    targets.set(id, { kind: "confirm", key: question.key });
  }
  if (items.length < 1 || items.length > MAX_ITEMS) {
    return err({ kind: "too_many_questions", count: items.length });
  }
  return ok({ body: { questions: items }, subject: { questions: items }, targets, questions });
}

function parseNumber(text: string, integer: boolean): number | undefined {
  const value = Number(text);
  if (text.trim().length === 0 || !Number.isFinite(value)) return undefined;
  return integer && !Number.isInteger(value) ? undefined : value;
}

function fieldValue(
  target: Extract<ItemTarget, { kind: "field" }>,
  answer: QuestionAnswer[string],
): JsonValue | undefined {
  const picked = answer.selected.map((id) => {
    if (target.type === "boolean") return id === "yes";
    const index = target.values.findIndex(
      (value) => value === id || `o${target.values.indexOf(value)}` === id,
    );
    return index < 0 ? id : target.values[index];
  });
  switch (target.type) {
    case "boolean":
      return picked[0];
    case "array":
      return picked.filter((value): value is JsonValue => value !== undefined);
    case "number":
    case "integer": {
      if (answer.text !== undefined) return parseNumber(answer.text, target.type === "integer");
      const first = picked[0];
      return typeof first === "number" ? first : undefined;
    }
    case "string":
      return answer.text ?? picked[0];
    default:
      return assertNever(target.type, "fieldValue");
  }
}

export type DecodeError =
  | ResponseError
  | { readonly kind: "bad_json"; readonly key: string }
  | { readonly kind: "bad_field"; readonly key: string; readonly field: string };

/** 사용자가 `QuestionAnswer`로 답했을 때 키별 응답으로 되돌린다 */
export function decodeAnswer(
  planned: PlannedQuestions,
  answer: QuestionAnswer,
): Result<JsonObject, DecodeError> {
  const contents = new Map<string, Record<string, JsonValue>>();
  const confirmed = new Set<string>();
  for (const [id, target] of planned.targets) {
    const given = answer[id];
    if (given === undefined) continue;
    if (target.kind === "confirm") {
      if (given.selected.length > 0) confirmed.add(target.key);
      continue;
    }
    if (target.kind === "whole_form") {
      const text = given.text ?? "";
      const json = text.length === 0 ? ok({}) : parseJson(text);
      const parsed = json.ok ? asJsonObject(json.value) : undefined;
      if (parsed === undefined) return err({ kind: "bad_json", key: target.key });
      contents.set(target.key, { ...parsed });
      continue;
    }
    const value = fieldValue(target, given);
    const content = contents.get(target.key) ?? {};
    if (value === undefined) {
      if (given.selected.length > 0 || (given.text ?? "").length > 0) {
        return err({ kind: "bad_field", key: target.key, field: target.field });
      }
      contents.set(target.key, content);
      continue;
    }
    content[target.field] = value;
    contents.set(target.key, content);
  }
  const keyed: KeyedAnswer[] = [];
  for (const question of planned.questions) {
    if (question.kind === "elicitation_form") {
      keyed.push({
        key: question.key,
        action: "accept",
        content: contents.get(question.key) ?? {},
      });
    } else if (confirmed.has(question.key)) {
      keyed.push({ key: question.key, action: "accept" });
    } else {
      keyed.push({ key: question.key, action: "decline" });
    }
  }
  return buildInputResponses(planned.questions, keyed);
}

/** 승인이 거부되거나 취소됐을 때: 모든 질문에 같은 동작으로 답한다 */
export function uniformAnswer(
  questions: readonly McpQuestion[],
  action: "decline" | "cancel",
): Result<JsonObject, ResponseError> {
  return buildInputResponses(
    questions,
    questions.map((question) => ({ key: question.key, action })),
  );
}

export type AskError =
  | PlanError
  | DecodeError
  | { readonly kind: "request_failed"; readonly error: ApprovalRequestError }
  | { readonly kind: "wait_cancelled" }
  | { readonly kind: "bad_answer" };

export interface AskInput {
  readonly threadId: ThreadId;
  readonly questions: readonly McpQuestion[];
  /** 승인 요청 멱등 키(1~48자). 같은 호출의 같은 라운드는 같은 키를 쓴다 */
  readonly requestId: string;
  readonly signal: AbortSignal;
}

const QuestionAnswerValueSchema = Type.Record(
  Type.String(),
  Type.Object({ selected: Type.Array(Type.String()), text: Type.Optional(Type.String()) }),
);

function snapshotToResponses(
  planned: PlannedQuestions,
  snapshot: L2ApprovalSnapshot,
): Result<JsonObject, AskError> {
  if (snapshot.state === "cancelled" || snapshot.resolution === null) {
    return uniformAnswer(planned.questions, "cancel");
  }
  if (snapshot.resolution.decision === "deny") return uniformAnswer(planned.questions, "decline");
  const answer = parse(QuestionAnswerValueSchema, snapshot.resolution.answer);
  if (!answer.ok) return err({ kind: "bad_answer" });
  return decodeAnswer(planned, answer.value);
}

/**
 * 질문을 `L2ApprovalsPort`(kind `question`)로 올리고 응답이 올 때까지 기다려 `inputResponses`를 돌려준다.
 * 프로세스가 끝나면 메모리 대기는 사라지므로, 재개 뒤에는 같은 `requestId`로 다시 부르면 저장된 해결을 읽는다
 * (L2ApprovalsPort.request의 멱등 규칙).
 */
export async function askWithApprovals(
  approvals: L2ApprovalsPort,
  input: AskInput,
): Promise<Result<JsonObject, AskError>> {
  const planned = planQuestionBody(input.questions);
  if (!planned.ok) return planned;
  const requested = await approvals.request({
    threadId: input.threadId,
    kind: "question",
    subject: planned.value.subject,
    requestId: input.requestId,
  });
  if (!requested.ok) return err({ kind: "request_failed", error: requested.error });
  let snapshot = requested.value;
  if (snapshot.state === "pending") {
    const waited = await approvals.wait(input.threadId, snapshot.approvalId, input.signal);
    if (!waited.ok) return err({ kind: "wait_cancelled" });
    snapshot = waited.value;
  }
  return snapshotToResponses(planned.value, snapshot);
}
