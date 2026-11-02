import type { ExtUiVersionPort } from "../../handlers/m4/ext-ui-version.ts";
import type { M4PortDeps } from "./deps.ts";

// ExtUiVersion 포트 구현. T-F 시점에는 빈 구현이다. T-XV가 채운다. `deps`는 `assembly/m4/index.ts`가 넘긴다.

export function createExtUiVersionPort(_deps: M4PortDeps): ExtUiVersionPort {
  return {};
}
