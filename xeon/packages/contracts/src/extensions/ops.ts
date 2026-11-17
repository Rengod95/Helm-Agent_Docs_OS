import type { ThreadId } from "../conversation/index.ts";
import type { Unsubscribe } from "../records/index.ts";
import type { DriveOptions, DriveStep } from "./drive.ts";
import type { HookName, HookSignatures, TapSig, FirstSig, ChainSig, CollectSig } from "./hooks.ts";
import type { EventAnchor, SubscribableEvent } from "./hook-positions.ts";
import type { PostItem, PostOptions, PostReceipt } from "./post.ts";
import type { RegistrationId } from "./registration-id.ts";

export type { Unsubscribe };

export interface HandlerContext<S> {
  readonly scopeId: RegistrationId;
  /** 디스패치 시작 시점에 마지막으로 커밋된 Registration 상태 */
  readonly state: Readonly<S>;
  readonly threadId: ThreadId;
  readonly signal: AbortSignal;
}

/** fold에 따라 핸들러 시그니처가 좁혀진다 */
export type Handler<N extends HookName, S = unknown> =
  HookSignatures[N] extends TapSig<infer P>
    ? (payload: Readonly<P>, ctx: HandlerContext<S>) => void | Promise<void>
    : HookSignatures[N] extends FirstSig<infer P, infer D>
      ? (payload: Readonly<P>, ctx: HandlerContext<S>) => D | undefined | Promise<D | undefined>
      : HookSignatures[N] extends ChainSig<infer P, infer V, infer X>
        ? (
            payload: Readonly<P>,
            current: Readonly<V>,
            ctx: HandlerContext<S>,
          ) => X | undefined | Promise<X | undefined>
        : HookSignatures[N] extends CollectSig<infer P, infer _V, infer C>
          ? (payload: Readonly<P>, ctx: HandlerContext<S>) => C | undefined | Promise<C | undefined>
          : never;

/** 핸들러가 받는 맥락. 구독 핸들러도 `g.on`과 같은 맥락을 받는다 */
export type EventContext<S = unknown> = HandlerContext<S>;

/**
 * 구독 표본 추출(M5e 스펙 §4.4.1). `every`는 모든 이벤트를 차례로 전달하고, `coalesce`는 구독자가 바쁜 동안 쌓인 이벤트를
 * 마지막 하나로 합친다. `coalesce`는 고빈도 이벤트(`isHighFrequency`)에만 허용된다
 */
export interface SubscribeOptions {
  readonly sample?: "every" | "coalesce";
}

/** 구독 핸들러가 받는 봉투. `payload`는 동결된다. `dropped`는 `coalesce` 구독에서 이 전달이 대신한 이벤트 수다 */
export interface EventEnvelope<E extends SubscribableEvent = SubscribableEvent> {
  readonly event: E;
  readonly threadId: ThreadId;
  /** 디스패치 키. 같은 이벤트의 재발화는 같은 값이다 */
  readonly eventKey: string;
  readonly payload: Readonly<HookSignatures[E]["payload"]>;
  readonly anchor?: EventAnchor;
  readonly dropped?: number;
}

export interface ExtensionOps<S> {
  on<N extends HookName>(point: N, handler: Handler<N, S>): Unsubscribe;
  /**
   * 이벤트 구독(M5e 스펙 §4.4.1). `on`의 tap 형태 위의 도우미다. 매니페스트 `hooks`에 선언되지 않은 이벤트는 `on`과 같이 거부한다.
   * `"all"`은 선언된 이벤트 이름 전부다. 핸들러의 반환값은 무시하고 예외는 tap 디스패치가 격리한다.
   */
  subscribe(
    events: readonly SubscribableEvent[] | "all",
    handler: (event: EventEnvelope, ctx: EventContext<S>) => void | Promise<void>,
    options?: SubscribeOptions,
  ): Unsubscribe;
  post(item: PostItem, options: PostOptions): Promise<PostReceipt>;
  /** 그룹만 쓴다. 등록만 하고 임대는 X가 중재한다 */
  drive(step: DriveStep<S>, options?: DriveOptions): void;
}
