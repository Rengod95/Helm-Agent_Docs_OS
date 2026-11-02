import type { WireHandlers } from "@fresnel/contracts/wire";
import { notImplemented } from "../not-implemented.ts";

// 확장 메서드·Plugin UI·버전 기록 wire. 처리기는 T-XV가 채운다.
// T-F가 `notImplemented`로 채워 둔 기본 처리기다(`spec-deltas/t-f.md` §5). 소유 트랙(T-XV)이 이 파일과
// `assembly/m4/ext-ui-version-port.ts`만 고쳐서 채운다. `handlers/index.ts`, `types.ts`, `assemble.ts`, `assembly/m4/index.ts`는 고치지 않는다.

/** 처리기가 쓰는 포트. 처음에는 메서드가 없다. T-XV가 메서드를 더한다 */
export type ExtUiVersionPort = Readonly<Record<string, never>>;

export type ExtUiVersionMethods =
  | "ext.versions"
  | "ext.rollback"
  | "ext.ui.list"
  | "ext.ui.post"
  | "ext.ui.requestApproval";

export function createExtUiVersionHandlers(
  _port: ExtUiVersionPort,
): Pick<WireHandlers, ExtUiVersionMethods> {
  return {
    "ext.versions": notImplemented("ext.versions"),
    "ext.rollback": notImplemented("ext.rollback"),
    "ext.ui.list": notImplemented("ext.ui.list"),
    "ext.ui.post": notImplemented("ext.ui.post"),
    "ext.ui.requestApproval": notImplemented("ext.ui.requestApproval"),
  };
}
