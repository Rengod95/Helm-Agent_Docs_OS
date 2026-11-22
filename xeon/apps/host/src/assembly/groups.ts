import type { ThreadId } from "@fresnel/contracts/conversation";
import { isOrchestrationExtension, type ExtensionManifest } from "@fresnel/contracts/extensions";
import {
  createOrchestrationService,
  type OrchestrationServiceDeps,
  type OrchestrationCatalogEntry,
  type OrchestrationServiceWithUsage,
} from "@fresnel/orchestration-sdk";
import type { ExtHost } from "@fresnel/ext-host";
import type { SettingsEngine } from "./settings-engine.ts";

// m2-plan HOST.6, L3.group-sdk.plan §8. orchestration-sdk은 서비스 팩토리(`createOrchestrationService`)만 내놓고 확장 단위가 없다. 이 파일이 서비스를 만들어
// 서비스가 받는 포트를 실제 구현으로 잇는다:
// - 그룹 목록(OrchestrationCatalogPort): 설치한 단위 가운데 L3 매니페스트
// 서비스는 조립 루트가 만들어 확장 읽기(`group.*`)에 넘긴다. 중재 포트와 구동 그룹 설정은 없다(E3, drive-isolation.md 2.2).
// 조립 루트 코드(DR-14 예외 2).

export interface HostOrchestrationsOptions {
  readonly ext: ExtHost;
  readonly settings: SettingsEngine;
  /** 서비스가 상태를 보여 줄 thread: 이 엔진이 가장 최근에 쓰기 소유를 쥔 thread */
  readonly currentThread: () => ThreadId | null;
  /** 설치된 단위 가운데 그룹(L3)의 매니페스트와 로드 순서 */
  readonly groups: () => readonly OrchestrationCatalogEntry[];
  /** 대화가 보는 도구 이름으로 도구 주인을 찾는다(승격 집계). 도구 이름이 대화마다 다르므로 이름만으로는 주인이 하나로 정해지지 않는다 */
  readonly toolOwnerIn?: OrchestrationServiceDeps["toolOwnerIn"];
}

/**
 * 그룹 카탈로그에 올릴 매니페스트인가. `group` 선언이 있고 id 없는 루트 플러그인이 L3다.
 * orchestration-sdk의 defineOrchestration이 그룹을 알아보는 기준(orchestrationOf)과 같다. 옛 형식의 `layer === "L3"`를 대신한다
 */
export function isOrchestrationCatalogManifest(manifest: ExtensionManifest): boolean {
  return (
    isOrchestrationExtension(manifest) &&
    (manifest.plugins ?? []).some((plugin) => plugin.id === undefined && plugin.layer === "L3")
  );
}

/**
 * 그룹 서비스(`fresnel.orchestration`)를 만든다. 조립 루트가 한 번 만들어 확장 읽기(`group.*`)에 넘긴다. 확장 단위가 아니다(AGE-33: 옛 `host-groups` 부품은 없앴다).
 * 서비스는 그룹 목록과 계측 읽기만 낸다. 설정 포트(`fresnel.settings`)는 ExtHost가 낸다.
 */
export function createHostOrchestrationService(
  options: HostOrchestrationsOptions,
): OrchestrationServiceWithUsage {
  return createOrchestrationService({
    host: options.ext,
    ...(options.toolOwnerIn === undefined ? {} : { toolOwnerIn: options.toolOwnerIn }),
    catalog: { groups: options.groups },
    currentThread: options.currentThread,
    instrumentation: () => options.settings.value("l3.orchestration.instrumentation") !== false,
  });
}
