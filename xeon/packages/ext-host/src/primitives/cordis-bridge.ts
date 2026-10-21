// Cordis(@xeon/vendor-cordis)를 import하는 유일한 파일이다(eng.dependency-rules.guide DR-11, X.primitives.plan §2).
// 루트 Context, scope 세대마다의 fiber, effect, 서비스 provide/inject만 쓴다. Context와 Fiber는 밖으로 내보내지 않는다.
// emit, parallel, serial, bail, waterfall과 Config 스키마는 쓰지 않는다(X.primitives.spec §4.3 함정 표).
import { Context } from "@xeon/vendor-cordis";
import { eachInOrder } from "./sequence.ts";

/** apply 안에서 받는 좁은 객체. Cordis ctx를 넘기지 않는다 */
export interface FiberHandle {
  readonly name: string;
  /** register가 돌려준 해제기를 이 fiber의 effect로 묶는다. 돌려주는 함수는 멱등이다 */
  effect(register: () => () => unknown, label?: string): () => void;
  /** 서비스 이름을 이 fiber의 effect로 provide한다. 돌려주는 함수는 멱등이다 */
  provide(name: string, value: unknown): () => void;
  /** inject한 서비스를 읽는다. 없거나 공급 fiber가 ACTIVE가 아니면 undefined */
  service(name: string): unknown;
}

interface OpenFiberSpec {
  readonly name: string;
  /** Cordis inject 이름들. 하나라도 없으면 fiber는 PENDING에 머물고 apply는 부르지 않는다 */
  readonly inject: readonly string[];
  readonly apply: (fiber: FiberHandle) => Promise<void>;
}

type FiberSettled = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

export interface OpenedFiber {
  readonly name: string;
  /** apply가 끝났거나 실패했을 때 정해진다. PENDING이면 곧바로 ok(apply는 아직) */
  readonly settled: Promise<FiberSettled>;
  /** fiber를 해제한다. effect 해제기를 모두 실행한 뒤 끝난다. 진행 중인 apply가 있으면 그것도 기다린다 */
  dispose(): Promise<void>;
}

export interface CordisBridge {
  openFiber(spec: OpenFiberSpec): OpenedFiber;
  /** ACTIVE인 공급 fiber의 서비스 값. 없으면 undefined */
  service(name: string): unknown;
  /** 모든 fiber의 비동기 상태 전이가 끝나기를 기다린다(서비스 공급·해제 연쇄) */
  quiesce(): Promise<void>;
  /** 열린 fiber를 열린 역순으로 해제한다 */
  dispose(): Promise<void>;
}

type PluginFiber = ReturnType<Context["plugin"]>;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/** 해제기를 한 번만 부르고, 거부된 Promise는 onError로 넘긴다 */
function once(dispose: () => unknown, onError: (error: unknown) => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    try {
      const result = dispose();
      if (isPromiseLike(result)) {
        Promise.resolve(result).catch(onError);
      }
    } catch (error) {
      onError(error);
    }
  };
}

const QUIESCE_ROUNDS = 8;

export function createCordisBridge(onError: (error: unknown) => void): CordisBridge {
  const root = new Context();
  const opened: { readonly name: string; readonly fiber: PluginFiber }[] = [];
  const disposers = new Map<object, () => Promise<void>>();

  function handleOf(ctx: Context, name: string): FiberHandle {
    return {
      name,
      effect(register, label) {
        const dispose = ctx.fiber.effect(() => register(), label);
        return once(dispose, onError);
      },
      provide(serviceName, value) {
        // Cordis 선언은 () => void지만 실제로는 해제를 마치면 끝나는 Promise를 돌려준다(X.primitives.spec §4.3)
        const dispose: () => unknown = ctx.provide(serviceName, value);
        return once(dispose, onError);
      },
      service(serviceName) {
        const value: unknown = ctx.reflect.get(serviceName);
        return value;
      },
    };
  }

  async function settleRound(rounds: number): Promise<void> {
    if (rounds === 0) return;
    const busy = opened.filter((entry) => entry.fiber.inertia !== undefined);
    await Promise.allSettled(busy.map((entry) => entry.fiber.inertia ?? Promise.resolve()));
    await Promise.resolve();
    if (busy.length > 0) await settleRound(rounds - 1);
  }

  return {
    openFiber(spec) {
      const wrapped = root.plugin({
        name: spec.name,
        inject: [...spec.inject],
        apply: async (ctx: Context): Promise<void> => {
          await spec.apply(handleOf(ctx, spec.name));
        },
      });
      const entry = { name: spec.name, fiber: wrapped };
      opened.push(entry);
      let disposePromise: Promise<void> | undefined;
      const dispose = (): Promise<void> => {
        disposePromise ??= (async () => {
          try {
            await wrapped.dispose();
          } finally {
            const index = opened.indexOf(entry);
            if (index >= 0) opened.splice(index, 1);
            disposers.delete(entry);
          }
        })();
        return disposePromise;
      };
      disposers.set(entry, dispose);
      const settled = (async (): Promise<FiberSettled> => {
        try {
          await wrapped;
          return { ok: true };
        } catch (error) {
          return { ok: false, error };
        }
      })();
      return { name: spec.name, settled, dispose };
    },
    service(name) {
      const value: unknown = root.reflect.get(name);
      return value;
    },
    quiesce: () => settleRound(QUIESCE_ROUNDS),
    async dispose() {
      await eachInOrder([...opened].toReversed(), async (entry) => {
        const dispose = disposers.get(entry);
        if (dispose !== undefined) {
          try {
            await dispose();
          } catch (error) {
            onError(error);
          }
        }
        return "continue";
      });
    },
  };
}
