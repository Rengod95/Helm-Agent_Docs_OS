import type { Engine, HostLogPort } from "../types.ts";
import { messageOf, sequentially } from "../util.ts";

// L4.host-service.spec §4.1 8단계, L1.persistence.spec §4.8.3, M3-REQ-80. 서비스 모드이고 `l1.persistence.autoResume`이 참일 때만 호출한다.
// 복구 표식이 남은 thread를 서비스가 쓰기 소유로 열어 이어서 실행한다. 재개 횟수 상한(`l1.persistence.maxResumeAttempts`)은 L1.persistence가 센다:
// 상한에 이른 thread는 `turn.resume`이 `nothing`을 돌려주므로 여기서 다시 실행하지 않는다. 다른 프로세스가 쥔 thread는 건드리지 않는다.
// 서비스가 쥔 잠금은 서비스가 닫힐 때까지 남는다(HS-27 [미결 20]).

const PAGE_LIMIT = 200;

export async function autoResumeThreads(engine: Engine, logger: HostLogPort): Promise<void> {
  const page = await engine.ports.threads.list({ limit: PAGE_LIMIT });
  const candidates = page.threads.filter((thread) => thread.resumable !== null);
  await sequentially(candidates, async (thread) => {
    const { threadId } = thread;
    try {
      const lock = await engine.ports.locks.tryAcquire(threadId, "service");
      if (!lock.ok) {
        logger.info("service.auto_resume_skipped", { threadId, reason: "locked" });
        return;
      }
      const resumed = await engine.ports.turns.resume(threadId);
      logger.info("service.auto_resume", {
        threadId,
        outcome: resumed.ok ? resumed.value.status : "error",
      });
    } catch (caught) {
      // 한 thread의 실패가 나머지 재개를 막지 않는다
      logger.error("service.auto_resume_failed", { threadId, message: messageOf(caught) });
    }
  });
}
