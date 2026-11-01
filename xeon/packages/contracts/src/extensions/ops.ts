import type { ThreadId } from "../conversation/index.ts";
import type { Unsubscribe } from "../records/index.ts";
import type { DriveFn, DriveOptions } from "./drive.ts";
import type { HookName, HookSignatures, TapSig, FirstSig, ChainSig, CollectSig } from "./hooks.ts";
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

export interface ExtensionOps<S> {
  on<N extends HookName>(point: N, handler: Handler<N, S>): Unsubscribe;
  post(item: PostItem, options: PostOptions): Promise<PostReceipt>;
  /** 그룹만 쓴다. 등록만 하고 임대는 X가 중재한다 */
  drive(fn: DriveFn<S>, options?: DriveOptions): void;
}
