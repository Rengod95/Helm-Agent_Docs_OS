// 대화 열기 한 번의 훅 순서(H-7): thread.resources(collect) → 결과 보관 → thread.start(tap). 새 대화, 다시 열기, 포크가 이 길 하나를 쓴다.
// 열기는 기다리지 않는다. 열기 훅의 결과는 openSettled와 applyOpenWorkspace가 읽는다. 훅이 실패해도 열기는 계속된다(open).
import { attemptAsync, detach, type Logger } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ResourcesValue, SessionStartPayload } from "@fresnel/contracts/extensions";
import type { ThreadHooks } from "./points.ts";

interface OpenRequest {
  readonly threadId: ThreadId;
  /** thread.resources의 사유 */
  readonly resourcesReason: "startup" | "reload";
  /** 대화 폴더. 없으면 빈 문자열 */
  readonly cwd: string;
  readonly start: SessionStartPayload;
  readonly resourcesKey: string;
  readonly startKey: string;
}

export interface OpenChain {
  /** 열기 한 번을 시작한다. 기다리지 않는다 */
  open(request: OpenRequest): void;
  /** 가장 최근 열기의 thread.resources 단계가 끝나기를 기다려 그 결과를 돌려준다. 실패했거나 열기가 없었으면 undefined다 */
  resources(threadId: ThreadId): Promise<ResourcesValue | undefined>;
  /** thread가 지워졌으면 그 결과를 버린다 */
  forget(threadId: ThreadId): void;
}

export interface OpenChainDeps {
  readonly points: ThreadHooks;
  readonly logger: Logger | undefined;
}

export function createOpenChain(deps: OpenChainDeps): OpenChain {
  const { points, logger } = deps;
  // thread마다 가장 최근 열기의 thread.resources 단계. 이 약속은 거부되지 않는다(실패는 undefined로 끝난다)
  const steps = new Map<ThreadId, Promise<ResourcesValue | undefined>>();

  const reportFailure = (threadId: ThreadId, point: string, cause: unknown): void => {
    logger?.warn("session.point_failed", { point, threadId, reason: String(cause) });
  };

  return {
    open(request): void {
      const { threadId } = request;
      const resourcesStep = (async (): Promise<ResourcesValue | undefined> => {
        const got = await attemptAsync(() =>
          points.resources(
            threadId,
            { cwd: request.cwd, reason: request.resourcesReason },
            request.resourcesKey,
          ),
        );
        if (got.ok) return got.value;
        reportFailure(threadId, "thread.resources", got.error.cause);
        return undefined;
      })();
      steps.set(threadId, resourcesStep);
      const whole = (async (): Promise<void> => {
        // thread.start는 thread.resources 단계가 끝난 뒤에 발화한다(H-7). 그 단계는 실패해도 거부되지 않는다
        await resourcesStep;
        const started = await attemptAsync(() => points.start(request.start, request.startKey));
        if (!started.ok) reportFailure(threadId, "thread.start", started.error.cause);
      })();
      detach(whole, (cause) => {
        reportFailure(threadId, "thread.start", cause);
      });
    },
    resources(threadId): Promise<ResourcesValue | undefined> {
      return steps.get(threadId) ?? Promise.resolve(undefined);
    },
    forget(threadId): void {
      steps.delete(threadId);
    },
  };
}
