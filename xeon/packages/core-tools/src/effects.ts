import { canonicalJson } from "@xeon/contracts";
import type { Clock } from "@xeon/contracts";
import type {
  EffectId,
  IdFactory,
  ItemId,
  JsonValue,
  ThreadId,
  ToolResultMessage,
} from "@xeon/contracts/conversation";
import type { ToolRunContext } from "@xeon/contracts/services";
import type {
  CommitRequest,
  EffectExec,
  EffectIntent,
  EffectResult,
  ProducerHandle,
  StampedDraft,
} from "@xeon/contracts/records";
import { sha256Hex, utf8Bytes } from "./util.ts";

// L1.tools.spec §3.9, §4.4. 도구 효과 커밋 3단(E1 의도, E2 실행 시작, E3 결과)의 요청을 만든다.
// 이 파일의 함수는 동기·순수하다. 시각과 ID는 호출자가 미리 만들어 넘기고, build 안에서 부르지 않는다.

export interface EffectKit {
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly clock: Clock;
}

/** ToolRunDrafts가 낸 초안이 ProducerHandle을 거친 것(StampedDraft)인가 */
export function isStampedDraft(value: unknown): value is StampedDraft {
  if (typeof value !== "object" || value === null) return false;
  return (
    "draft" in value &&
    "producer" in value &&
    typeof value.producer === "string" &&
    typeof value.draft === "object"
  );
}

interface Scope {
  readonly threadId: ThreadId;
  readonly turnId: ToolRunContext["turnId"];
  readonly stepId: ToolRunContext["stepId"];
}

function scopeOf(run: ToolRunContext): Scope {
  return { threadId: run.threadId, turnId: run.turnId, stepId: run.stepId };
}

export interface IntentInput {
  readonly run: ToolRunContext;
  readonly key: string;
  readonly intent: EffectIntent;
}

export function intentRequest(kit: EffectKit, input: IntentInput): CommitRequest {
  const { run, key, intent } = input;
  const scope = scopeOf(run);
  const draft = kit.producer.draft({
    id: kit.ids.next("evt"),
    kind: "effect.intent",
    ...scope,
    causationId: null,
    correlationId: intent.effectId,
    payload: intent,
  });
  return {
    threadId: scope.threadId,
    requestId: `tool:${key}:intent`,
    fingerprintSource: {
      kind: "effect.intent",
      toolCallId: intent.toolCallId,
      toolName: intent.toolName,
      argsHash: intent.argsHash,
      replay: intent.replay,
      idempotencyKey: intent.idempotencyKey,
    },
    build: (view) => {
      if (view.turnAbortRequested(scope.turnId)) {
        return { kind: "reject", code: "turn_aborting", detail: null };
      }
      if (view.effectByToolCall(scope.threadId, intent.toolCallId) !== undefined) {
        return { kind: "reject", code: "intent_exists", detail: null };
      }
      return { kind: "append", drafts: [draft], checkpoint: null };
    },
  };
}

export interface ExecInput {
  readonly run: ToolRunContext;
  readonly key: string;
  readonly toolCallId: string;
  readonly effectId: EffectId;
  /** 처음 실행은 0. 재실행은 1부터 */
  readonly attempt: number;
  readonly startedAt: number;
}

export function execRequest(kit: EffectKit, input: ExecInput): CommitRequest {
  const { run, effectId } = input;
  const scope = scopeOf(run);
  const exec: EffectExec = { effectId, startedAt: input.startedAt };
  const draft = kit.producer.draft({
    id: kit.ids.next("evt"),
    kind: "effect.exec",
    ...scope,
    causationId: null,
    correlationId: effectId,
    payload: exec,
  });
  return {
    threadId: scope.threadId,
    requestId:
      input.attempt === 0 ? `tool:${input.key}:exec` : `tool:${input.key}:exec:${input.attempt}`,
    fingerprintSource: {
      kind: "effect.exec",
      toolCallId: input.toolCallId,
      attempt: input.attempt,
    },
    build: (view) => {
      const effect = view.effect(effectId);
      if (effect === undefined) return { kind: "reject", code: "effect_missing", detail: null };
      if (effect.result !== null) return { kind: "reject", code: "already_settled", detail: null };
      if (view.turnAbortRequested(scope.turnId)) {
        return { kind: "reject", code: "turn_aborting", detail: null };
      }
      return { kind: "append", drafts: [draft], checkpoint: null };
    },
  };
}

export interface ResultInput {
  readonly run: ToolRunContext;
  readonly key: string;
  readonly toolCallId: string;
  readonly result: EffectResult;
  /** 같은 커밋에 넣을 toolResult item. 루프가 만든 초안이 StampedDraft가 아니면 undefined */
  readonly item: StampedDraft | undefined;
  /** 같은 커밋에 넣을 secret.masked 초안 */
  readonly extra: readonly StampedDraft[];
}

/** E3. effect.result와 toolResult item.recorded를 한 커밋으로 쓴다(F.records.spec §3.5 기록 순서 3) */
export function resultRequest(kit: EffectKit, input: ResultInput): CommitRequest {
  const { run, result } = input;
  const scope = scopeOf(run);
  const resultDraft = kit.producer.draft({
    id: kit.ids.next("evt"),
    kind: "effect.result",
    ...scope,
    causationId: null,
    correlationId: result.effectId,
    payload: result,
  });
  const drafts: readonly StampedDraft[] = [
    resultDraft,
    ...(input.item === undefined ? [] : [input.item]),
    ...input.extra,
  ];
  return {
    threadId: scope.threadId,
    requestId: `tool:${input.key}:result`,
    fingerprintSource: { kind: "effect.result", toolCallId: input.toolCallId },
    build: (view) => {
      const effect = view.effect(result.effectId);
      if (effect === undefined) return { kind: "reject", code: "effect_missing", detail: null };
      if (effect.result !== null) return { kind: "reject", code: "already_settled", detail: null };
      return { kind: "append", drafts, checkpoint: null };
    },
  };
}

export interface ItemInput {
  readonly run: ToolRunContext;
  readonly itemId: ItemId;
  /** 효과 기록과 함께 쓰면 그 효과, 효과 없이 닫는 호출이면 null */
  readonly effectId: EffectId | null;
  readonly message: ToolResultMessage;
}

/**
 * 루프가 만든 toolResult item 초안을 커밋에 넣을 수 있는 형태로 받는다. F의 ToolRunDrafts.toolResultItem은 루프 생산자가
 * 낙인한 StampedDraft를 낸다. 그렇지 않은 초안(낙인 없음)이 오면 undefined를 돌려주고 호출자가 effect.result만 커밋한다.
 */
export function itemDraftOf(input: ItemInput): StampedDraft | undefined {
  const made: unknown = input.run.drafts.toolResultItem({
    itemId: input.itemId,
    message: input.message,
    effectId: input.effectId,
  });
  return isStampedDraft(made) ? made : undefined;
}

export interface ItemOnlyInput {
  readonly run: ToolRunContext;
  readonly key: string;
  readonly toolCallId: string;
  readonly item: StampedDraft;
  /** 같은 커밋에 넣을 secret.masked 초안 */
  readonly extra: readonly StampedDraft[];
}

/**
 * 효과 없이 닫는 호출(미발견, 인자 오류, 거부, 실행 전 중단, 출력 절단)의 toolResult item을 한 커밋으로 쓴다.
 * 커밋 키는 효과 결과와 같은 `tool:<key>:result`다. 한 호출은 둘 중 하나만 쓴다.
 */
export function itemOnlyRequest(input: ItemOnlyInput): CommitRequest {
  const { run } = input;
  return {
    threadId: run.threadId,
    requestId: `tool:${input.key}:result`,
    fingerprintSource: { kind: "tool_result_item", toolCallId: input.toolCallId },
    build: () => ({ kind: "append", drafts: [input.item, ...input.extra], checkpoint: null }),
  };
}

/** 이벤트 하나(256 KiB 상한, ENVELOPE_MAX_BYTES)에 싣는 구조화 필드의 상한. 넘으면 크기만 남긴다 */
const EVENT_FIELD_MAX_BYTES = 128 * 1024;

/** details·structuredContent가 이벤트 상한을 넘기지 않게 한다. 모델용 content는 경계화가 따로 줄인다 */
export function fitForEvent(value: JsonValue | null): JsonValue | null {
  const bytes = utf8Bytes(canonicalJson(value)).length;
  return bytes <= EVENT_FIELD_MAX_BYTES ? value : { xeonOversize: bytes };
}

/** 인자의 정규화 JSON 해시(sha256 hex) */
export function argsHashOf(args: Readonly<Record<string, unknown>>): Promise<string> {
  return sha256Hex(canonicalJson(args));
}
