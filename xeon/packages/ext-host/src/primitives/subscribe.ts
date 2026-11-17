import { attemptAsync, Bug } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  anchorOfEvent,
  isHighFrequency,
  isSubscribableEvent,
  type EventEnvelope,
  type HandlerContext,
  type HookName,
  type RegistrationId,
  type SubscribableEvent,
  type SubscribeOptions,
  type Unsubscribe,
} from "@fresnel/contracts/extensions";
import { ambient, withAmbient } from "./ambient.ts";
import { PrimitiveError } from "./errors.ts";

// M5e 스펙 §4.4.1 `g.subscribe`. `g.on`의 tap 형태 위의 얇은 도우미다. 이벤트 하나마다 `g.on` 등록을 하나 한다.
// - every: 대화마다 차례로 전달한다. 핸들러 결과는 tap 디스패치가 기다리고 예외는 tap이 격리한다.
// - coalesce(고빈도 이벤트만): 구독자가 바쁜 동안 들어온 이벤트는 마지막 하나로 합친다. 디스패치를 붙잡지 않고 뒤에서 돈다(core.track).
//   뒤에서 도는 호출은 그 이벤트의 디스패치 맥락을 다시 싣고 돈다. 처리 상태 칸(handler, drive)만 비운다.

/** 구독 요청을 정리한 것. 중복은 뺀다. 선언되지 않은 이름과 이벤트가 아닌 이름은 `g.on`과 같이 거부한다 */
export function subscribedNames(
  events: readonly SubscribableEvent[] | "all",
  declared: readonly HookName[],
  scopeId: RegistrationId,
  sample: NonNullable<SubscribeOptions["sample"]>,
): readonly SubscribableEvent[] {
  const explicit = events !== "all";
  const requested: readonly HookName[] =
    events === "all" ? declared.filter(isSubscribableEvent) : events;
  const names: SubscribableEvent[] = [];
  for (const name of requested) {
    if (!declared.includes(name)) {
      throw new PrimitiveError(
        "hook_undeclared",
        `subscribe("${name}") is not listed in the hooks of plugin ${scopeId}`,
        { scopeId },
      );
    }
    if (!isSubscribableEvent(name)) {
      throw new PrimitiveError(
        "subscribe_not_event",
        `${name} is not an event hook, and subscribe takes event hooks only`,
        { scopeId },
      );
    }
    if (explicit && sample === "coalesce" && !isHighFrequency(name)) {
      throw new PrimitiveError(
        "subscribe_not_high_frequency",
        `${name} is not high-frequency, and sample "coalesce" applies only to high-frequency events`,
        { scopeId },
      );
    }
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** 이벤트 하나를 구독 핸들러가 받는 봉투로 만든다. 흐름 자리(anchor)는 위치 표에서 온다 */
function envelopeOf(input: {
  readonly name: SubscribableEvent;
  readonly threadId: ThreadId;
  readonly eventKey: string;
  readonly payload: EventEnvelope["payload"];
  readonly dropped: number | undefined;
}): EventEnvelope {
  const anchor = anchorOfEvent(input.name);
  return {
    event: input.name,
    threadId: input.threadId,
    eventKey: input.eventKey,
    payload: input.payload,
    ...(anchor === undefined ? {} : { anchor }),
    ...(input.dropped === undefined ? {} : { dropped: input.dropped }),
  };
}

export interface SubscribeInput<S> {
  readonly names: readonly SubscribableEvent[];
  readonly handler: (event: EventEnvelope, ctx: HandlerContext<S>) => void | Promise<void>;
  /** 이벤트마다 표본 방식. `coalesce`는 고빈도 이벤트에만 준다 */
  readonly sampleOf: (name: SubscribableEvent) => "every" | "coalesce";
  /** `g.on`으로 한 이벤트를 등록한다. 등록 해제 함수를 돌려준다 */
  readonly register: (
    name: SubscribableEvent,
    fn: (payload: EventEnvelope["payload"], ctx: HandlerContext<S>) => void | Promise<void>,
  ) => Unsubscribe;
  /** 기다리지 않는 작업을 추적한다. 거부는 진단으로 보고된다(core.track) */
  readonly track: (task: Promise<unknown>) => void;
  /**
   * 지금 도는 디스패치의 키와, 그 맥락을 다시 싣고 뒤에서 도는 실행기. 핸들러 안에서만 부른다.
   * 엔진 안은 ambient에서, 격리 자식은 요청 문맥(scopes)에서 읽는다
   */
  readonly dispatchOf: () => DispatchContext;
}

/**
 * 지금 도는 디스패치의 맥락. `rerun`은 그 맥락을 다시 싣고 뒤에서 일을 돌린다. `dropped`는 격리 알림에서 엔진이 이 전달 앞에서
 * 합친 수다(엔진 안에서는 없다)
 */
export interface DispatchContext {
  readonly eventKey: string;
  readonly rerun: (work: () => Promise<void>) => Promise<void>;
  readonly dropped?: number;
}

/** 대화 하나의 줄. every는 `tail`로 차례를 잇고, coalesce는 `busy`와 `pending`으로 마지막 하나만 남긴다 */
interface Lane<S> {
  tail: Promise<void>;
  busy: boolean;
  pending: Pending<S> | undefined;
}

/** coalesce에서 기다리는 전달 하나. 맥락과 디스패치 키를 함께 싣는다 */
interface Pending<S> {
  readonly name: SubscribableEvent;
  readonly payload: EventEnvelope["payload"];
  readonly eventKey: string;
  readonly ctx: HandlerContext<S>;
  readonly rerun: DispatchContext["rerun"];
  readonly dropped: number;
}

/** 엔진 안의 디스패치 맥락. 핸들러 안에서 실행 중인 ambient와 키다. 밖에서 부르면 구독이 잘못 쓰인 것이라 버그다 */
export function ambientDispatch(): DispatchContext {
  const current = ambient();
  if (current === undefined || current.dispatchKey === null) {
    throw new Bug("subscribe.no_dispatch_context: an event handler runs inside a dispatch");
  }
  return {
    eventKey: current.dispatchKey,
    rerun: (work) => withAmbient({ ...current, handler: null, drive: null }, work),
  };
}

export function subscribeWith<S>(input: SubscribeInput<S>): Unsubscribe {
  const { handler, track } = input;
  const lanes = new Map<ThreadId, Lane<S>>();
  let closed = false;

  const laneOf = (threadId: ThreadId): Lane<S> => {
    const found = lanes.get(threadId);
    if (found !== undefined) return found;
    const lane: Lane<S> = { tail: Promise.resolve(), busy: false, pending: undefined };
    lanes.set(threadId, lane);
    return lane;
  };

  /**
   * coalesce의 뒤 실행. 전달 하나를 돌리고, 그 사이에 쌓인 대기 칸이 있으면 이어서 돈다. 칸이 비면 줄을 쉬게 한다.
   * 앞선 전달이 실패해도 뒤의 칸은 돈다. 실패는 모두 돈 뒤에 처음 것을 다시 던져 추적기가 진단으로 보고한다.
   */
  const drain = async (lane: Lane<S>, item: Pending<S>): Promise<void> => {
    const ran = await attemptAsync(async () => {
      const envelope = envelopeOf({
        name: item.name,
        threadId: item.ctx.threadId,
        eventKey: item.eventKey,
        payload: item.payload,
        dropped: item.dropped,
      });
      await item.rerun(async () => {
        await handler(envelope, item.ctx);
      });
    });
    const next = lane.pending;
    lane.pending = undefined;
    if (next === undefined) {
      lane.busy = false;
      if (!ran.ok) throw ran.error.cause;
      return;
    }
    const later = await attemptAsync(() => drain(lane, next));
    if (!ran.ok) throw ran.error.cause;
    if (!later.ok) throw later.error.cause;
  };

  const unsubscribes = input.names.map((name) =>
    input.register(name, (payload, ctx) => {
      if (closed) return undefined;
      const dispatch = input.dispatchOf();
      const { rerun, eventKey } = dispatch;
      const lane = laneOf(ctx.threadId);
      if (input.sampleOf(name) === "every") {
        const envelope = envelopeOf({
          name,
          threadId: ctx.threadId,
          eventKey,
          payload,
          dropped: dispatch.dropped,
        });
        const run = lane.tail.then(() => handler(envelope, ctx));
        lane.tail = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      }
      // coalesce: 바쁜 동안 들어온 것은 대기 칸을 덮고, 덮인 수만큼 dropped가 는다. 엔진이 앞에서 합친 수도 더한다
      const item: Pending<S> = {
        name,
        payload,
        eventKey,
        ctx,
        rerun,
        dropped:
          (dispatch.dropped ?? 0) + (lane.pending === undefined ? 0 : lane.pending.dropped + 1),
      };
      if (lane.busy) {
        lane.pending = item;
        return undefined;
      }
      lane.busy = true;
      track(drain(lane, item));
      return undefined;
    }),
  );

  return () => {
    closed = true;
    lanes.clear();
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
