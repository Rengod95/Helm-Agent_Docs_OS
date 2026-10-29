import { parse } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { SessionLabeledPayloadSchema, type DurableEventEnvelope } from "@xeon/contracts/records";

// L2.artifacts.spec §3.4, §4.3.3. 라벨은 artifact.session_labeled 이벤트를 접어 얻는다. 이벤트는 전체 목록(교체)이므로
// 같은 세션의 마지막 유효 이벤트가 이긴다. 산출물 수는 artifact.registered를 센다(보관해도 줄지 않는다, §4.1.6).
// 투영 테이블을 두지 않는다. 같은 이벤트 열은 늘 같은 결과를 낸다.

/** 세션 메타가 읽는 이벤트 접두. 라벨과 산출물 수를 한 번의 읽기로 함께 접는다 */
export const SESSION_META_EVENT_PREFIXES: readonly string[] = [
  "artifact.registered",
  "artifact.session_labeled",
];

/** 세션별 메타. 라벨이 없는 세션은 빈 목록이고, 산출물이 없는 세션은 0이다 */
export interface SessionMetaIndex {
  readonly labels: ReadonlyMap<ThreadId, readonly string[]>;
  readonly artifactCounts: ReadonlyMap<ThreadId, number>;
}

/** 이벤트 열을 접는다. 모양이 틀린 라벨 이벤트는 건너뛴다(앞의 유효한 값이 남는다) */
export function foldSessionMeta(events: readonly DurableEventEnvelope[]): SessionMetaIndex {
  const labels = new Map<ThreadId, readonly string[]>();
  const artifactCounts = new Map<ThreadId, number>();
  for (const event of events) {
    if (event.kind === "artifact.registered") {
      artifactCounts.set(event.threadId, (artifactCounts.get(event.threadId) ?? 0) + 1);
      continue;
    }
    if (event.kind === "artifact.session_labeled") {
      const payload = parse(SessionLabeledPayloadSchema, event.payload);
      if (payload.ok) labels.set(event.threadId, payload.value.labels);
    }
  }
  return { labels, artifactCounts };
}
