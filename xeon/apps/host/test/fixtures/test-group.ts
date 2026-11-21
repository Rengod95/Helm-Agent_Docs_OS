import { createSmokeOrchestration, type SmokeOrchestrationProbe } from "@fresnel/ext-host/testing";
import type { IdFactory } from "@fresnel/contracts/conversation";
import type { HostPluginModule } from "../../src/types.ts";

// M1 걸어 다니는 골격의 테스트용 그룹(on·post·drive·scope). L3.group-sdk.plan이 정하는 위치가 생기기 전에는 host 시험이
// 자기 것을 둔다(L4.host-service.plan §7). 구현은 ext-host의 스모크 그룹이다.

export interface TestOrchestration {
  readonly module: HostPluginModule;
  readonly probe: SmokeOrchestrationProbe;
}

export function testOrchestration(ids: IdFactory): TestOrchestration {
  const { unit, probe } = createSmokeOrchestration({ ids });
  return { module: { manifest: unit.manifest, extension: unit.entry }, probe };
}
