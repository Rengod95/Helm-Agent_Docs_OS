import { attemptAsync, err, rethrow, type Logger } from "@xeon/contracts";
import type { AgentsLoop } from "@xeon/core-agents";
import { PrimitiveError, type ExtHost } from "@xeon/ext-host";
import { messageOf } from "../util.ts";

// L1.loop.spec §4.6 마지막 항목: 자식 turn의 경계 지점은 열린 thread를 요구하므로 호스트가 자식 thread를 `ExtHost.openThread`로 열어 둔다.
// core-agents가 자식 thread를 만들고(thread.started, agent.spawned) `runChildTurn`을 부르는 사이에 열 틈이 없어, 조립 루트가 이 감싸개를
// `agentsPlugin({ loop })`에 넘긴다. 열기와 닫기가 한 호출 안에 묶이므로 끝난 자식의 확장 상태가 메모리에 남지 않는다.
// 조립 루트 코드(DR-14 예외 2).

export function openingChildThreads(
  resolve: () => AgentsLoop,
  ext: Pick<ExtHost, "openThread" | "closeThread">,
  logger: Logger,
): AgentsLoop {
  return {
    async runChildTurn(request) {
      const opened = await attemptAsync(() => ext.openThread(request.threadId, { child: true }));
      if (!opened.ok) {
        const cause = opened.error.cause;
        // 확장 상태를 읽지 못한 것(busy, io, 손상 행)은 예상 가능한 실패다. 자식 turn을 시작하지 않고 저장소 오류로 알린다
        if (cause instanceof PrimitiveError && cause.code === "storage_unavailable") {
          logger.warn("agents.child_open_failed", {
            threadId: request.threadId,
            message: messageOf(cause),
          });
          return err({ kind: "io", code: "ext_state_unreadable" });
        }
        return rethrow(cause);
      }
      try {
        return await resolve().runChildTurn(request);
      } finally {
        const closed = await attemptAsync(() => ext.closeThread(request.threadId));
        if (!closed.ok) {
          logger.warn("agents.child_close_failed", {
            threadId: request.threadId,
            message: messageOf(closed.error.cause),
          });
        }
      }
    },
  };
}
