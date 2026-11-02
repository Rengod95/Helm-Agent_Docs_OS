import type { DialogAreaPort } from "../../handlers/m4/dialog-area.ts";
import type { M4PortDeps } from "./deps.ts";

// DialogArea 포트 구현. T-F 시점에는 빈 구현이다. T-WC가 채운다. `deps`는 `assembly/m4/index.ts`가 넘긴다.

export function createDialogAreaPort(_deps: M4PortDeps): DialogAreaPort {
  return {};
}
