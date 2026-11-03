import {
  ArtifactsRegistry,
  ArtifactsReviews,
  ArtifactsSessions,
  DialogAsk,
  DialogAside,
  DialogAttachments,
  DialogCommands,
  DialogNotify,
  DialogStatus,
  DialogStyles,
  KnowledgeLedger,
  KnowledgeMemory,
  KnowledgeSearch,
  KnowledgeSkills,
  McpClient,
  ScheduleEntries,
  WebBrowse,
  WebFetch,
  WebResearch,
  WebSearch,
  WorkGoals,
  WorkPlans,
  WorkReports,
  WorkTasks,
  WorkspaceFiles,
  WorkspaceImages,
  WorkspaceShell,
  type AnyCapabilityDef,
  type CapabilityId,
  type SemVer,
} from "@fresnel/contracts/capabilities";
import { capabilityDefTable, type CapabilityDefLookup } from "@fresnel/ext-host";

// 기능 래퍼(X.primitives.spec §4.4.7)가 재실행되는 코드(on 핸들러, drive 함수)의 기능 호출을 메서드의 `idempotent`·`readOnly` 선언으로
// 검사하려면 정의가 필요하다. `ServiceKey`는 id와 버전만 싣기 때문에 조립 루트가 내장 기능 정의 표를 ExtHostDeps.capabilityDefs로 넘긴다.
// 조립 루트 코드(DR-14 예외 2). 새 내장 기능 정의를 contracts에 더하면 이 목록에도 더한다(capability-defs.test.ts가 빠진 정의를 잡는다).

/** F가 내보내는 내장 L2 기능 정의 전체 */
export const BUILTIN_CAPABILITY_DEFS: readonly AnyCapabilityDef[] = [
  ArtifactsRegistry,
  ArtifactsReviews,
  ArtifactsSessions,
  DialogAsk,
  DialogAside,
  DialogAttachments,
  DialogCommands,
  DialogNotify,
  DialogStatus,
  DialogStyles,
  KnowledgeLedger,
  KnowledgeMemory,
  KnowledgeSearch,
  KnowledgeSkills,
  McpClient,
  ScheduleEntries,
  WebBrowse,
  WebFetch,
  WebResearch,
  WebSearch,
  WorkGoals,
  WorkPlans,
  WorkReports,
  WorkTasks,
  WorkspaceFiles,
  WorkspaceImages,
  WorkspaceShell,
];

/** 내장 정의에 확장이 공급하는 기능의 정의(`extra`)를 더한 조회 함수 */
export function capabilityDefsOf(extra: readonly AnyCapabilityDef[] = []): CapabilityDefLookup {
  return capabilityDefTable([...BUILTIN_CAPABILITY_DEFS, ...extra]);
}

/**
 * 코어가 제공하는 기능과 버전. 외부 확장 로더가 `requires`를 채울 때 외부 `provides`와 함께 본다(X.loading-trust.spec §4.8 b).
 * `web.research`는 공급자가 아직 없어(cap-web 2차) 뺀다.
 */
export function coreCapabilityVersions(): ReadonlyMap<CapabilityId, SemVer> {
  const out = new Map<CapabilityId, SemVer>();
  for (const def of BUILTIN_CAPABILITY_DEFS) {
    if (def.id === "web.research") continue;
    out.set(def.id, def.version);
  }
  return out;
}
