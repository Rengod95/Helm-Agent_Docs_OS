import type { DevkitPort } from "../../handlers/m4/devkit.ts";
import type { M4PortDeps } from "./deps.ts";

// Devkit 포트 구현. T-F 시점에는 빈 구현이다. T-AUTH가 채운다. `deps`는 `assembly/m4/index.ts`가 넘긴다.

export function createDevkitPort(_deps: M4PortDeps): DevkitPort {
  return {};
}
