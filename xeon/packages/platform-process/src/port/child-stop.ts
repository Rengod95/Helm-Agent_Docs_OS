import type { Scheduler } from "@fresnel/contracts";
import type { BackgroundStopper } from "@fresnel/contracts/services";
import type { PipedChild } from "./spawn-piped.ts";

// L0.process.spec §4.3 정지 순서. 파이프로 띄운 자식을 레지스트리가 부르는 `BackgroundStopper`로 만든다.
// graceful: stdin 닫기 → `stdinCloseMs` 안에 끝나지 않으면 SIGTERM(트리). force: SIGKILL(트리).
// 레지스트리는 graceful 뒤 `graceMs`가 지나면 force를 부른다. 그래서 전체 순서는 stdin 닫기, 유예, SIGTERM, 유예, SIGKILL이다.

/** graceful 정지에서 stdin을 닫은 뒤 SIGTERM을 보내기 전까지 기다리는 시간(ms) 기본값 */
export const DEFAULT_STDIN_CLOSE_MS = 500;

export function stopperOfPiped(
  child: PipedChild,
  deps: { readonly scheduler: Scheduler; readonly stdinCloseMs: number },
): BackgroundStopper {
  return {
    async stop(mode) {
      if (mode === "force") {
        child.signalTree("force");
        return;
      }
      child.stdin.end();
      const ended = await new Promise<boolean>((resolve) => {
        const timer = deps.scheduler.setTimeout(() => {
          resolve(false);
        }, deps.stdinCloseMs);
        const settled = (): boolean => {
          deps.scheduler.clearTimeout(timer);
          resolve(true);
          return true;
        };
        child.exited.then(settled, settled);
      });
      if (!ended) child.signalTree("graceful");
    },
    exited: child.exited,
  };
}
