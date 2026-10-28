import type { ThreadId } from "../conversation/index.ts";
import type { Unsubscribe } from "../records/index.ts";
import type { DriveFn, DriveOptions } from "./drive.ts";
import type {
  PointName,
  PointSignatures,
  TapSig,
  FirstSig,
  ChainSig,
  CollectSig,
} from "./points.ts";
import type { PostItem, PostOptions, PostReceipt } from "./post.ts";
import type { ScopeId } from "./scope-id.ts";

export type { Unsubscribe };

export interface HandlerContext<S> {
  readonly scopeId: ScopeId;
  /** 디스패치 시작 시점에 마지막으로 커밋된 scope 상태 */
  readonly state: Readonly<S>;
  readonly threadId: ThreadId;
  readonly signal: AbortSignal;
}

/** fold에 따라 핸들러 시그니처가 좁혀진다 */
export type Handler<N extends PointName, S = unknown> =
  PointSignatures[N] extends TapSig<infer P>
    ? (payload: Readonly<P>, ctx: HandlerContext<S>) => void | Promise<void>
    : PointSignatures[N] extends FirstSig<infer P, infer D>
      ? (payload: Readonly<P>, ctx: HandlerContext<S>) => D | undefined | Promise<D | undefined>
      : PointSignatures[N] extends ChainSig<infer P, infer V, infer X>
        ? (
            payload: Readonly<P>,
            current: Readonly<V>,
            ctx: HandlerContext<S>,
          ) => X | undefined | Promise<X | undefined>
        : PointSignatures[N] extends CollectSig<infer P, infer _V, infer C>
          ? (payload: Readonly<P>, ctx: HandlerContext<S>) => C | undefined | Promise<C | undefined>
          : never;

export interface ExtensionOps<S> {
  on<N extends PointName>(point: N, handler: Handler<N, S>): Unsubscribe;
  post(item: PostItem, options: PostOptions): Promise<PostReceipt>;
  /** 그룹만 쓴다. 등록만 하고 임대는 X가 중재한다 */
  drive(fn: DriveFn<S>, options?: DriveOptions): void;
}
