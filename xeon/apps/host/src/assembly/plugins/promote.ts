import { err, ok, type Result } from "@fresnel/contracts";
import { buildPluginCard } from "./card.ts";
import type { PluginFolder } from "./folder-reader.ts";
import type { PluginStore, ReviewActor, ReviewDecision, ReviewOrigin } from "./store.ts";

// 원본 폴더 하나를 검토본 저장소에 넣는 공통 단계(M5c §4.6.4, §7). 시작 때의 번들 넣기, 설치본 옮김, `.history` 옮김,
// 느슨한 스킬 폴더 옮김이 모두 이 함수를 쓴다. 검토 항목을 거치지 않는다.

const HASH_PREFIX_LENGTH = "sha256:".length;

/** 넣는 방식. 호출자가 출처, 행위자, 결정, 종류를 고른다 */
export interface PromotePlan {
  readonly name: string;
  readonly origin: ReviewOrigin;
  readonly actor: ReviewActor;
  readonly decision: ReviewDecision;
  readonly kind: "bundled" | "migrated";
}

export interface PromoteOutcome {
  readonly contentHash: string;
  /** 기록을 남기지 못했으면 거짓이다. 검토본은 이미 들어갔다 */
  readonly logged: boolean;
}

/** 넣지 못한 이유. `code`는 저장소 오류의 종류나 원본 문제의 이름이다 */
export interface PromoteFailure {
  readonly code: string;
  readonly message: string;
}

/**
 * 폴더 하나를 검토본으로 넣는다: 스냅샷, 승격, 필요하면 `current` 교체, 기록. 스냅샷을 읽은 해시가 `folder`의 해시와 같은지
 * 확인하므로(복사 중 바뀐 것은 넣지 않는다) 원본을 다시 읽지 않는다. 승격한 사본이 있으면 `candidates/` 취급으로 다음 시작에 정리된다.
 */
export async function promoteFolder(
  store: PluginStore,
  dir: string,
  folder: PluginFolder,
  plan: PromotePlan,
  times: { readonly approvedAt: string; readonly logAt: string },
  options: { readonly current: boolean },
): Promise<Result<PromoteOutcome, PromoteFailure>> {
  const snapshot = await store.snapshotCandidate(dir);
  if (!snapshot.ok) {
    return err({
      code: snapshot.error.kind,
      message: `${plan.name} could not be copied: ${snapshot.error.kind}`,
    });
  }
  const contentHash = folder.contentHash;
  if (snapshot.value.contentHash !== contentHash) {
    await store.discardCandidate(snapshot.value.contentHash);
    return err({ code: "source_unstable", message: `${plan.name} changed while it was copied` });
  }
  // 기록의 `itemId`가 이 값이다. `recover`는 기록에 없는 검토본을 승인 도중 끊긴 것으로 보고 지우므로 빠지면 안 된다
  const decisionId = `${plan.actor}:${contentHash.slice(HASH_PREFIX_LENGTH, HASH_PREFIX_LENGTH + 8)}`;
  const promoted = await store.promote(contentHash, {
    name: plan.name,
    version: folder.manifest.version,
    contentHash,
    approvedAt: times.approvedAt,
    decisionId,
    origin: plan.origin,
    inferredManifest: folder.inferred,
    card: buildPluginCard({
      folder,
      origin: { kind: plan.origin },
      review: {
        state: "approved",
        currentHash: contentHash,
        pendingItemId: null,
        approvedAt: times.approvedAt,
      },
      usedBy: [],
      health: { state: "idle", lastActiveAt: null, lastError: null },
    }),
  });
  if (!promoted.ok) {
    return err({
      code: promoted.error.kind,
      message: `${plan.name} could not be promoted: ${promoted.error.kind}`,
    });
  }
  if (options.current) {
    const switched = await store.setCurrent(plan.name, contentHash);
    if (!switched.ok) {
      return err({
        code: switched.error.kind,
        message: `${plan.name} could not be made current: ${switched.error.kind}`,
      });
    }
  }
  const logged = await store.appendLog({
    at: times.logAt,
    itemId: decisionId,
    name: plan.name,
    kind: plan.kind,
    candidateHash: contentHash,
    baseHash: null,
    decision: plan.decision,
    profileIds: [],
    actor: plan.actor,
    provenance: null,
    originThreadId: null,
  });
  return ok({ contentHash, logged: logged.ok });
}
