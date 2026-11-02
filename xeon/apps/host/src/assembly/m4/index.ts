import { err } from "@fresnel/contracts";
import type { ExtHost } from "@fresnel/ext-host";
import type { TestRunControlPort, TraceReadPort } from "@fresnel/contracts/extensions";
import type { DevkitPort } from "../../handlers/m4/devkit.ts";
import type { DialogAreaPort } from "../../handlers/m4/dialog-area.ts";
import type { ExtReadPort } from "../../handlers/m4/ext-read.ts";
import type { ExtUiVersionPort } from "../../handlers/m4/ext-ui-version.ts";
import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import type { M4HostEnv, M4PortDeps } from "./deps.ts";
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

/** 계측이 없는 읽기. 계측이 꺼진 것처럼 보인다 */
const emptyTraceRead: TraceReadPort = {
  enabled: () => false,
  turn: () => undefined,
  timings: () => ({ traceEnabled: false, timings: [] }),
};

/** Test run 제어가 없는 호스트. 모든 제어가 `not_available`이다 */
const emptyTestRunControl: TestRunControlPort = {
  pause: () => err({ kind: "not_available" }),
  resume: () => err({ kind: "not_available" }),
  step: () => err({ kind: "not_available" }),
  phase: () => err({ kind: "not_available" }),
};

/**
 * `host`는 T-XD가 계측 읽기와 Test run 제어를 ext-host 구현으로 바꿀 때 쓴다. T-F 시점에는 쓰지 않는다.
 * 소유 트랙은 이 함수를 고치지 않는다(T-XD의 두 줄 제외).
 */
export function createM4Ports(_host: ExtHost, env: M4HostEnv): M4Ports {
  const deps: M4PortDeps = {
    traceRead: emptyTraceRead,
    testRunControl: emptyTestRunControl,
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
