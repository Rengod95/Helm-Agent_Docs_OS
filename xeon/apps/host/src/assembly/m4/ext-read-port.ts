import type { ExtReadPort } from "../../handlers/m4/ext-read.ts";
import type { M4PortDeps } from "./deps.ts";

// ExtRead 포트 구현. T-F 시점에는 빈 구현이다. T-WA가 채운다. `deps`는 `assembly/m4/index.ts`가 넘긴다.

export function createExtReadPort(_deps: M4PortDeps): ExtReadPort {
  return {};
}
