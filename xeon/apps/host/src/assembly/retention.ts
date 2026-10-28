import type { Logger } from "@xeon/contracts";
import type { SessionService } from "@xeon/contracts/records";

// L1.persistence.spec §6.1: 보관 정리는 엔진 열기 때 한 번 돈다. 조립 루트가 계약의 `SessionService.retention.prune()`을 부른다.
// 기간과 수 상한이 둘 다 0(기본)이면 아무것도 지우지 않는다. 설정은 managed·user 범위만 받는다. 조립 루트 코드(DR-14 예외 2).

/** 보관 정리를 한 번 돌리고 지운 수를 남긴다. 실패해도 시작을 막지 않는다 */
export function pruneOnOpen(session: Pick<SessionService, "retention">, logger: Logger): void {
  const pruned = session.retention.prune();
  if (!pruned.ok) {
    logger.warn("retention.prune_failed", { kind: pruned.error.kind });
    return;
  }
  if (pruned.value.length > 0) logger.info("retention.pruned", { count: pruned.value.length });
}
