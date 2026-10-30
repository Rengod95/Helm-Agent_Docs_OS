import { Bug, parse } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  ArtifactArchivedPayloadSchema,
  ArtifactRegisteredPayloadSchema,
  ArtifactUpdatedPayloadSchema,
  type BlobRef,
  type DurableEventEnvelope,
} from "@xeon/contracts/records";
import {
  ArtifactKindSchema,
  ArtifactMetaSchema,
  type ArtifactKind,
  type ArtifactMeta,
  type ArtifactSummary,
} from "@xeon/contracts/capabilities";

// L2.artifacts.spec §3.2, §4.1. 산출물 레지스트리 상태는 artifact.registered·updated·archived 이벤트를 커밋 순서로 접어 얻는다.
// 투영 테이블을 두지 않는다. 접는 규칙은 순수하고, 같은 이벤트 열은 늘 같은 상태를 낸다.

/** 산출물 레지스트리가 읽는 이벤트 접두. 리뷰의 `artifact.review_*`와 섞이지 않는다 */
export const REGISTRY_EVENT_PREFIXES: readonly string[] = [
  "artifact.registered",
  "artifact.updated",
  "artifact.archived",
];

export interface ArtifactVersionState {
  readonly version: number;
  readonly title: string;
  readonly content: BlobRef;
  readonly sourcePath: string | null;
  readonly meta: ArtifactMeta;
}

export interface ArtifactState {
  readonly artifactId: string;
  readonly threadId: ThreadId;
  readonly kind: ArtifactKind;
  readonly status: ArtifactSummary["status"];
  /** 등록 이벤트의 envelope threadId·turnId와 payload의 toolCallId·producer */
  readonly origin: ArtifactSummary["origin"];
  /** 등록 이벤트의 recordedAt */
  readonly createdAt: number;
  /** 마지막 `artifact.updated`의 recordedAt. 등록 뒤 갱신이 없으면 createdAt. 보관은 갱신이 아니다 */
  readonly updatedAt: number;
  /** 버전 1부터 커밋 순서대로 */
  readonly versions: readonly ArtifactVersionState[];
}

export type ArtifactStates = ReadonlyMap<string, ArtifactState>;

/**
 * 산출물 이벤트를 접는다. 모양이 틀린 이벤트, 등록되지 않은 산출물의 갱신, 버전이 맞지 않는 갱신은 건너뛴다.
 * 같은 artifactId로 두 번 등록된 경우 첫 등록만 남긴다.
 */
export function foldArtifacts(events: readonly DurableEventEnvelope[]): ArtifactStates {
  const states = new Map<string, ArtifactState>();
  for (const event of events) {
    if (event.kind === "artifact.registered") {
      const payload = parse(ArtifactRegisteredPayloadSchema, event.payload);
      if (!payload.ok || states.has(payload.value.artifactId)) continue;
      const kind = parse(ArtifactKindSchema, payload.value.kind);
      const meta = parse(ArtifactMetaSchema, payload.value.meta);
      if (!kind.ok || !meta.ok) continue;
      states.set(payload.value.artifactId, {
        artifactId: payload.value.artifactId,
        threadId: event.threadId,
        kind: kind.value,
        status: "active",
        origin: {
          threadId: event.threadId,
          turnId: event.turnId,
          toolCallId: payload.value.toolCallId,
          producer: payload.value.producer,
        },
        createdAt: event.recordedAt,
        updatedAt: event.recordedAt,
        versions: [
          {
            version: 1,
            title: payload.value.title,
            content: payload.value.content,
            sourcePath: payload.value.sourcePath,
            meta: meta.value,
          },
        ],
      });
      continue;
    }
    if (event.kind === "artifact.updated") {
      const payload = parse(ArtifactUpdatedPayloadSchema, event.payload);
      if (!payload.ok) continue;
      const state = states.get(payload.value.artifactId);
      const latest = state === undefined ? undefined : latestOf(state);
      if (state === undefined || latest === undefined) continue;
      if (payload.value.version !== latest.version + 1) continue;
      // meta가 null이면 바뀌지 않은 것이고, 값이 있으면 전체를 바꾼다(§3.6)
      let meta: ArtifactMeta = latest.meta;
      if (payload.value.meta !== null) {
        const parsed = parse(ArtifactMetaSchema, payload.value.meta);
        if (!parsed.ok) continue;
        meta = parsed.value;
      }
      states.set(state.artifactId, {
        ...state,
        updatedAt: event.recordedAt,
        versions: [
          ...state.versions,
          {
            version: payload.value.version,
            title: payload.value.title ?? latest.title,
            content: payload.value.content ?? latest.content,
            sourcePath: payload.value.sourcePath,
            meta,
          },
        ],
      });
      continue;
    }
    if (event.kind === "artifact.archived") {
      const payload = parse(ArtifactArchivedPayloadSchema, event.payload);
      if (!payload.ok) continue;
      const state = states.get(payload.value.artifactId);
      if (state !== undefined) states.set(state.artifactId, { ...state, status: "archived" });
    }
  }
  return states;
}

/** 가장 최근 버전. 등록 이벤트가 버전 1을 만들므로 비지 않는다 */
export function latestOf(state: ArtifactState): ArtifactVersionState | undefined {
  return state.versions.at(-1);
}

/** 한 버전의 요약. 제목·본문·메타는 버전마다, 상태와 출처와 시각은 산출물마다 하나다 */
export function summaryOf(state: ArtifactState, version: ArtifactVersionState): ArtifactSummary {
  return {
    artifactId: state.artifactId,
    kind: state.kind,
    title: version.title,
    version: version.version,
    status: state.status,
    content: version.content,
    sourcePath: version.sourcePath,
    meta: version.meta,
    origin: state.origin,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

/** 최신 버전 요약. 상태가 비지 않은 산출물에만 쓴다 */
export function latestSummaryOf(state: ArtifactState): ArtifactSummary {
  const latest = latestOf(state);
  if (latest === undefined) throw new Bug(`artifact ${state.artifactId} has no version`);
  return summaryOf(state, latest);
}
