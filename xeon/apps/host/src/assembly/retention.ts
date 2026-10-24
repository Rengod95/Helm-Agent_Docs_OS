import type { Logger, Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { StoreError } from "@xeon/contracts/records";

// L1.persistence.spec §6.1 [제안]: 보관 정리는 엔진 열기 때 한 번 돈다. 조립 루트가 `SessionServiceImpl.retention.prune()`을 부른다.
// F `SessionService`는 `retention`을 내지 않지만 core-persistence가 올린 서비스 객체는 갖고 있다. 기간과 수 상한이 둘 다 0(기본)이면
// 아무것도 지우지 않는다. 설정은 managed·user 범위만 받는다. 조립 루트 코드(DR-14 예외 2).

interface Pruner {
  prune(): Result<readonly ThreadId[], StoreError>;
}

function isPruner(value: unknown): value is Pruner {
  return (
    typeof value === "object" &&
    value !== null &&
    "prune" in value &&
    typeof value.prune === "function"
  );
}

/** 세션 서비스가 보관 정리를 내면 한 번 돌리고 지운 수를 남긴다. 실패해도 시작을 막지 않는다 */
export function pruneOnOpen(session: object, logger: Logger): void {
  const retention: unknown = Reflect.get(session, "retention");
  if (!isPruner(retention)) {
    logger.warn("retention.unavailable", { effect: "old threads are not pruned" });
    return;
  }
  const pruned = retention.prune();
  if (!pruned.ok) {
    logger.warn("retention.prune_failed", { kind: pruned.error.kind });
    return;
  }
  if (pruned.value.length > 0) logger.info("retention.pruned", { count: pruned.value.length });
}
