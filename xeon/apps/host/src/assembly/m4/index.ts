import { testRunControlOf, traceReadOf, type ExtHost } from "@fresnel/ext-host";
import type { DevkitPort } from "../../handlers/m4/devkit.ts";
import type { DialogAreaPort } from "../../handlers/m4/dialog-area.ts";
import type { ExtReadPort } from "../../handlers/m4/ext-read.ts";
import type { ExtUiVersionPort } from "../../handlers/m4/ext-ui-version.ts";
import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import type { M4EngineDeps, M4HostEnv, M4PortDeps } from "./deps.ts";
import { createDevkitPort } from "./devkit-port.ts";
import { createDialogAreaPort } from "./dialog-area-port.ts";
import { createExtReadPort } from "./ext-read-port.ts";
import { createExtUiVersionPort } from "./ext-ui-version-port.ts";
import { createProfileTestRunPort } from "./profile-test-run-port.ts";

// M4 wire 처리기 43개의 포트 묶음(`spec-deltas/t-f.md` §5). 이 파일은 T-F가 한 번 쓰고, 그 뒤에는 T-XD가
// 계측 읽기와 Test run 제어(`emptyTraceRead`, `emptyTestRunControl`)를 ext-host 구현으로 바꾸는 한 줄만 고친다.

export interface M4Ports {
  readonly extRead: ExtReadPort;
  readonly extUi: ExtUiVersionPort;
  readonly profileTestRun: ProfileTestRunPort;
  readonly dialogArea: DialogAreaPort;
  readonly devkit: DevkitPort;
}

/**
 * 계측 읽기와 Test run 제어는 ext-host 구현(`traceReadOf`, `testRunControlOf`)이다(T-XD).
 * 소유 트랙은 이 함수를 고치지 않는다.
 */
export function createM4Ports(host: ExtHost, engine: M4EngineDeps, env: M4HostEnv): M4Ports {
  const deps: M4PortDeps = {
    ...engine,
    traceRead: traceReadOf(host),
    testRunControl: testRunControlOf(host),
    env,
  };
  return {
    extRead: createExtReadPort(deps),
    extUi: createExtUiVersionPort(deps),
    profileTestRun: createProfileTestRunPort(deps),
    dialogArea: createDialogAreaPort(deps),
    devkit: createDevkitPort(deps),
  };
}
