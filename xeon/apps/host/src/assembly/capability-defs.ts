import {
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
} from "@xeon/contracts/capabilities";
import { capabilityDefTable, type CapabilityDefLookup } from "@xeon/ext-host";

// 능력 래퍼(X.primitives.spec §4.4.7)가 재실행되는 코드(on 핸들러, drive 함수)의 능력 호출을 메서드의 `idempotent`·`readOnly` 선언으로
// 검사하려면 정의가 필요하다. `ServiceKey`는 id와 버전만 싣기 때문에 조립 루트가 내장 능력 정의 표를 ExtHostDeps.capabilityDefs로 넘긴다.
// 조립 루트 코드(DR-14 예외 2). 새 내장 능력 정의를 contracts에 더하면 이 목록에도 더한다(capability-defs.test.ts가 빠진 정의를 잡는다).

/** F가 내보내는 내장 L2 능력 정의 전체 */
export const BUILTIN_CAPABILITY_DEFS: readonly AnyCapabilityDef[] = [
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

/** 내장 정의에 확장이 공급하는 능력의 정의(`extra`)를 더한 조회 함수 */
export function capabilityDefsOf(extra: readonly AnyCapabilityDef[] = []): CapabilityDefLookup {
  return capabilityDefTable([...BUILTIN_CAPABILITY_DEFS, ...extra]);
}
