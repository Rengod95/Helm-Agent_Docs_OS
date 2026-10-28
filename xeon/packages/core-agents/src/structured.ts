// 구조화 모델 완성(L1.models.spec §4.10의 최소형). 스키마를 매개변수로 가진 도구 하나를 광고해 그 호출 인자를 TypeBox로 검증한다.
// F `ModelService`에 `completeStructured`가 아직 없어 core-agents가 `resolve`·`complete` 위에 둔다 [제안]. 판정(§4.8)이 쓴다.
import {
  Type,
  type Static,
  type TArray,
  type TLiteral,
  type TObject,
  type TSchema,
  type TString,
  type TUnion,
} from "typebox";
import { err, ok, parse, parseJson, repeatAsync, type Result } from "@xeon/contracts";
import type {
  AssistantMessage,
  Context,
  Message,
  ThreadId,
  TurnId,
  Usage,
} from "@xeon/contracts/conversation";
import type { ModelRole, ModelService } from "@xeon/contracts/services";

/** 이 호출이 쓰는 ModelService의 부분 */
export type StructuredModels = Pick<ModelService, "resolve" | "complete">;

export const STRUCTURED_TOOL_NAME = "final_answer";

export interface StructuredRequest<S extends TSchema> {
  readonly role: ModelRole;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly signal?: AbortSignal;
  readonly schema: S;
  readonly system: string;
  readonly prompt: string;
  /** 스키마를 어겼을 때 오류 문구를 붙여 다시 묻는 최대 시도 수. 기본 1(다시 묻지 않음), 최대 5 */
  readonly maxAttempts?: number;
  /** 시각(ms). 메시지 timestamp에 쓴다 */
  readonly now: number;
}

export interface StructuredSuccess<T> {
  readonly value: T;
  readonly usage: Usage | null;
  readonly model: { readonly provider: string; readonly modelId: string };
  readonly attempts: number;
}

export type StructuredError =
  /** 역할을 해석하지 못했다 */
  | { readonly kind: "model_unavailable"; readonly message: string }
  /** 모델 호출이 오류나 중단으로 끝났다 */
  | { readonly kind: "call_failed"; readonly message: string; readonly usage: Usage | null }
  /** 모든 시도의 응답이 스키마를 어겼다 */
  | {
      readonly kind: "schema_violation";
      readonly message: string;
      readonly usage: Usage | null;
      readonly model: { readonly provider: string; readonly modelId: string };
    };

const MAX_ATTEMPTS = 5;

function addUsage(left: Usage | null, right: Usage): Usage {
  if (left === null) return right;
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

/** 응답에서 후보 값 하나를 꺼낸다: 도구 호출 인자가 먼저, 없으면 텍스트 전체를 JSON으로 */
function candidateOf(message: AssistantMessage): unknown {
  for (const block of message.content) {
    if (block.type === "toolCall" && block.name === STRUCTURED_TOOL_NAME) {
      return block.argumentsError === undefined ? block.arguments : undefined;
    }
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  if (text.length === 0) return undefined;
  // 코드 펜스 안의 JSON도 받는다
  const body = text.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  const parsed = parseJson(body);
  return parsed.ok ? parsed.value : undefined;
}

export async function completeStructured<S extends TSchema>(
  models: StructuredModels,
  request: StructuredRequest<S>,
): Promise<Result<StructuredSuccess<Static<S>>, StructuredError>> {
  const resolved = models.resolve(request.role);
  if (!resolved.ok) {
    return err({ kind: "model_unavailable", message: `models.${resolved.error.kind}` });
  }
  const model = {
    provider: resolved.value.binding.provider,
    modelId: resolved.value.binding.modelId,
  };
  const attempts = Math.min(Math.max(request.maxAttempts ?? 1, 1), MAX_ATTEMPTS);
  const messages: Message[] = [{ role: "user", content: request.prompt, timestamp: request.now }];
  let usage: Usage | null = null;
  let lastProblem = "no structured answer";
  let attempt = 0;
  return await repeatAsync<Result<StructuredSuccess<Static<S>>, StructuredError>>(async () => {
    attempt += 1;
    const context: Context = {
      systemPrompt: `${request.system}\n\nAnswer by calling the ${STRUCTURED_TOOL_NAME} tool exactly once.`,
      messages: [...messages],
      tools: [
        {
          name: STRUCTURED_TOOL_NAME,
          description: "Submit the final structured answer.",
          parameters: request.schema,
        },
      ],
    };
    const reply = await models.complete({
      resolved: resolved.value,
      context,
      threadId: request.threadId,
      turnId: request.turnId,
      stepId: null,
      role: request.role,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    usage = addUsage(usage, reply.usage);
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      return {
        value: err({
          kind: "call_failed",
          message: reply.errorMessage ?? `model stopped with ${reply.stopReason}`,
          usage,
        }),
      };
    }
    const candidate = candidateOf(reply);
    const checked = parse(request.schema, candidate);
    if (checked.ok) {
      return { value: ok({ value: checked.value, usage, model, attempts: attempt }) };
    }
    lastProblem =
      candidate === undefined
        ? "the reply had no valid structured answer"
        : checked.error.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
    if (attempt >= attempts) {
      return { value: err({ kind: "schema_violation", message: lastProblem, usage, model }) };
    }
    messages.push(reply, {
      role: "user",
      content: `The answer was rejected: ${lastProblem}. Call ${STRUCTURED_TOOL_NAME} again with a valid answer.`,
      timestamp: request.now,
    });
    return undefined;
  });
}

/** 판정이 쓰는 스키마(§4.8 출력 스키마) */
export const JudgeAnswerSchema: TObject<{
  verdict: TUnion<[TLiteral<"met">, TLiteral<"not_met">, TLiteral<"undecidable">]>;
  rationale: TString;
  missing: TArray<TString>;
}> = Type.Object(
  {
    verdict: Type.Union([
      Type.Literal("met"),
      Type.Literal("not_met"),
      Type.Literal("undecidable"),
    ]),
    rationale: Type.String({ maxLength: 8000 }),
    missing: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 64 }),
  },
  { additionalProperties: false },
);
