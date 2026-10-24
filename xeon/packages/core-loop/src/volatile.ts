import { assertNever, type Clock, type Logger } from "@xeon/contracts";
import type {
  IdFactory,
  ItemUpdate,
  LifecycleEvent,
  ThreadId,
  TurnId,
} from "@xeon/contracts/conversation";
import type { SessionService, VolatileEventEnvelope } from "@xeon/contracts/records";

// L1.loop.spec §3.4 "휘발 발신". 휘발 kind(turn.updated, step.updated, item.started, item.updated)만 envelope로 낸다.
// `n`은 (threadId, turnId)마다 0부터 1씩, `afterSeq`는 발신 직전 내구 head seq다.

/** 토큰 델타를 묶는 시간 창(ms) [제안: eng.events.design §4.3] */
export const VOLATILE_COALESCE_MS: number = 50;
/** 휘발 델타 `data` 하나의 상한(바이트) [제안: eng.events.design §4.3] */
export const VOLATILE_DELTA_MAX_BYTES: number = 16 * 1024;

export type VolatileNotification = Extract<
  LifecycleEvent,
  { readonly type: "turn.updated" | "step.updated" | "item.started" | "item.updated" }
>;

export function isVolatileNotification(event: LifecycleEvent): event is VolatileNotification {
  return (
    event.type === "turn.updated" ||
    event.type === "step.updated" ||
    event.type === "item.started" ||
    event.type === "item.updated"
  );
}

export interface VolatileEmitterDeps {
  readonly session: Pick<SessionService, "emitVolatile" | "feed">;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  /** 휘발 알림을 내지 못했을 때 남기는 로그. 없으면 기록 없이 버린다 */
  readonly logger?: Logger | undefined;
}

export interface VolatileEmitter {
  /** 알림 하나를 낸다. 같은 파트의 토큰 델타는 시간 창 안에서 묶는다 */
  emit(notification: VolatileNotification): void;
  /** 묶어 둔 델타를 낸다. 내구 커밋이나 비델타 알림 앞에서 부른다 */
  flush(): void;
}

function payloadOf(notification: VolatileNotification): unknown {
  switch (notification.type) {
    case "turn.updated":
      return {
        status: notification.status,
        ...(notification.notice === undefined ? {} : { notice: notification.notice }),
      };
    case "step.updated":
      return { status: notification.status };
    case "item.started":
      return {
        itemId: notification.itemId,
        kind: notification.kind,
        toolCallId: notification.toolCallId,
        toolName: notification.toolName,
      };
    case "item.updated":
      return { itemId: notification.itemId, update: notification.update };
    default:
      return assertNever(notification, "VolatileNotification");
  }
}

const encoder = new TextEncoder();

/** 문자열을 UTF-8 기준 maxBytes 이하 조각으로 나눈다. 코드 포인트를 쪼개지 않는다 */
export function splitByBytes(text: string, maxBytes: number): readonly string[] {
  if (text.length === 0) return [""];
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > maxBytes && current.length > 0) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  chunks.push(current);
  return chunks;
}

type PartDeltaUpdate = Extract<ItemUpdate, { readonly kind: "part_delta" }>;

interface Pending {
  readonly note: Extract<VolatileNotification, { readonly type: "item.updated" }>;
  readonly update: PartDeltaUpdate;
  text: string;
  readonly startedAt: number;
}

export function createVolatileEmitter(deps: VolatileEmitterDeps): VolatileEmitter {
  const counters = new Map<string, number>();
  let pending: Pending | null = null;

  function send(notification: VolatileNotification): void {
    // afterSeq를 읽지 못하면 이 알림은 내지 않는다. 휘발 알림은 저장되지 않는 최선 노력이고(F.records.spec §4.3)
    // 내구 이벤트와 다음 알림이 상태를 따라잡게 한다. 번호 n은 건너뛰지 않는다
    const head = deps.session.feed.headSeq();
    if (!head.ok) {
      deps.logger?.warn("loop.volatile_dropped", {
        threadId: notification.threadId,
        turnId: notification.turnId,
        type: notification.type,
        reason: head.error.kind,
      });
      return;
    }
    const key = String(notification.turnId);
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    const envelope: VolatileEventEnvelope = {
      id: deps.ids.next("evt"),
      kind: notification.type,
      version: 1,
      threadId: notification.threadId,
      turnId: notification.turnId,
      stepId: notification.stepId,
      recordedAt: deps.clock.now(),
      causationId: null,
      correlationId: null,
      payload: payloadOf(notification),
      durable: false,
      n,
      afterSeq: head.value,
    };
    deps.session.emitVolatile(envelope);
  }

  function flush(): void {
    const held = pending;
    if (held === null) return;
    pending = null;
    for (const piece of splitByBytes(held.text, VOLATILE_DELTA_MAX_BYTES)) {
      send({
        ...held.note,
        update: { kind: "part_delta", delta: { ...held.update.delta, delta: piece } },
      });
    }
  }

  function emit(notification: VolatileNotification): void {
    if (notification.type === "item.updated" && notification.update.kind === "part_delta") {
      const { delta } = notification.update;
      if (delta.phase === "delta") {
        const now = deps.clock.now();
        const held = pending;
        if (
          held !== null &&
          held.update.delta.partId === delta.partId &&
          now - held.startedAt < VOLATILE_COALESCE_MS
        ) {
          held.text += delta.delta;
          return;
        }
        flush();
        pending = {
          note: notification,
          update: notification.update,
          text: delta.delta,
          startedAt: now,
        };
        return;
      }
    }
    flush();
    send(notification);
  }

  return { emit, flush };
}
