import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { EventWire, VolatileEventWire } from "@xeon/contracts/wire";
import { eventId, itemId, threadId } from "./ids.ts";

// 시험용 이벤트 초안. seq와 id는 가짜 서버가 붙인다. payload 모양은 F 카탈로그 스키마를 따른다.

export interface EventDraft {
  readonly kind: EventWire["kind"];
  readonly turnId: TurnId | null;
  readonly payload: unknown;
  readonly redactions?: readonly string[];
}

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function userItem(turn: TurnId, item: number, text: string): EventDraft {
  return {
    kind: "item.recorded",
    turnId: turn,
    payload: {
      item: {
        itemId: itemId(item),
        status: "completed",
        kind: "user",
        message: { role: "user", content: text, timestamp: 1 },
        requestId: null,
      },
    },
  };
}

export function assistantItem(
  turn: TurnId,
  item: number,
  options: { readonly text?: string; readonly thinking?: string; readonly toolCallId?: string },
): EventDraft {
  const content: unknown[] = [];
  if (options.thinking !== undefined)
    content.push({ type: "thinking", thinking: options.thinking });
  if (options.text !== undefined) content.push({ type: "text", text: options.text });
  if (options.toolCallId !== undefined) {
    content.push({ type: "toolCall", id: options.toolCallId, name: "read", arguments: {} });
  }
  return {
    kind: "item.recorded",
    turnId: turn,
    payload: {
      item: {
        itemId: itemId(item),
        status: "completed",
        kind: "assistant",
        message: {
          role: "assistant",
          content,
          api: "tape-messages",
          provider: "tape",
          model: "tape-1",
          usage: USAGE,
          stopReason: options.toolCallId === undefined ? "stop" : "toolUse",
          timestamp: 2,
        },
        partIds: [],
      },
    },
  };
}

export function effectIntent(
  turn: TurnId,
  options: {
    readonly effect: number;
    readonly item: number;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: Readonly<Record<string, unknown>>;
  },
): EventDraft {
  return {
    kind: "effect.intent",
    turnId: turn,
    payload: {
      effectId: `efx_${eventId(options.effect).slice(4)}`,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      itemId: itemId(options.item),
      argsHash: "0".repeat(64),
      args: options.args,
      replay: "safe",
      idempotencyKey: null,
    },
  };
}

export function toolResultItem(
  turn: TurnId,
  options: {
    readonly item: number;
    readonly effect: number | null;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly text: string;
    readonly details?: unknown;
    readonly isError?: boolean;
  },
): EventDraft {
  return {
    kind: "item.recorded",
    turnId: turn,
    payload: {
      item: {
        itemId: itemId(options.item),
        status: "completed",
        kind: "toolResult",
        message: {
          role: "toolResult",
          toolCallId: options.toolCallId,
          toolName: options.toolName,
          content: [{ type: "text", text: options.text }],
          details: options.details ?? null,
          isError: options.isError ?? false,
          timestamp: 3,
        },
        effectId: options.effect === null ? null : `efx_${eventId(options.effect).slice(4)}`,
      },
    },
  };
}

export function effectResult(
  turn: TurnId,
  options: { readonly effect: number; readonly synthesized: boolean; readonly resultItem: number },
): EventDraft {
  return {
    kind: "effect.result",
    turnId: turn,
    payload: {
      effectId: `efx_${eventId(options.effect).slice(4)}`,
      status: options.synthesized ? "interrupted" : "ok",
      resultItemId: itemId(options.resultItem),
      output: null,
      blobRef: null,
      durationMs: 1,
      synthesized: options.synthesized,
    },
  };
}

export function turnCompleted(
  turn: TurnId,
  status: "completed" | "interrupted" | "failed" = "completed",
  error: string | null = null,
): EventDraft {
  return {
    kind: "turn.completed",
    turnId: turn,
    payload: { status, stepCount: 1, usage: null, error },
  };
}

/** 휘발 조각: 본문 텍스트 조각 */
export function textChunk(options: {
  readonly turn: TurnId;
  readonly item: number;
  readonly n: number;
  readonly afterSeq: number;
  readonly delta: string;
}): VolatileEventWire {
  return {
    id: eventId(900 + options.n),
    kind: "item.updated",
    version: 1,
    durable: false,
    threadId: threadId(1),
    turnId: options.turn,
    stepId: null,
    recordedAt: "2026-01-05T00:00:00.000Z",
    causationId: null,
    correlationId: null,
    n: options.n,
    afterSeq: options.afterSeq,
    payload: {
      itemId: itemId(options.item),
      update: {
        kind: "part_delta",
        delta: {
          partId: `prt_${eventId(1).slice(4)}`,
          itemId: itemId(options.item),
          contentIndex: 0,
          kind: "text",
          phase: "delta",
          delta: options.delta,
        },
      },
    },
  };
}

function iso(n: number): string {
  return new Date(1_767_571_200_000 + n * 1000).toISOString();
}

/** 초안에 seq와 id를 붙여 전송 표현 이벤트로 만든다 */
export function materialize(
  draft: EventDraft,
  options: { readonly seq: number; readonly id: number; readonly thread: ThreadId },
): EventWire {
  return {
    id: eventId(options.id),
    kind: draft.kind,
    version: 1,
    durable: true,
    seq: options.seq,
    parentId: null,
    threadId: options.thread,
    turnId: draft.turnId,
    stepId: null,
    recordedAt: iso(options.seq),
    causationId: null,
    correlationId: null,
    payload: draft.payload,
    redactions: [...(draft.redactions ?? [])],
  };
}
