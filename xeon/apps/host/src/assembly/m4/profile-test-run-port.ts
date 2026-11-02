import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import type { M4PortDeps } from "./deps.ts";

// ProfileTestRun 포트 구현. T-F 시점에는 빈 구현이다. T-WB가 채운다. `deps`는 `assembly/m4/index.ts`가 넘긴다.

export function createProfileTestRunPort(_deps: M4PortDeps): ProfileTestRunPort {
  return {};
}
