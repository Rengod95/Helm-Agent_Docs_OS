import type { WireHandlers } from "@fresnel/contracts/wire";
import { notImplemented } from "../not-implemented.ts";

// 제작 wire(서비스 `fresnel.devkit`). 처리기는 T-AUTH가 채운다.
// T-F가 `notImplemented`로 채워 둔 기본 처리기다(`spec-deltas/t-f.md` §5). 소유 트랙(T-AUTH)이 이 파일과
// `assembly/m4/devkit-port.ts`만 고쳐서 채운다. `handlers/index.ts`, `types.ts`, `assemble.ts`, `assembly/m4/index.ts`는 고치지 않는다.

/** 처리기가 쓰는 포트. 처음에는 메서드가 없다. T-AUTH가 메서드를 더한다 */
export type DevkitPort = Readonly<Record<string, never>>;

export type DevkitMethods =
  | "ext.kinds"
  | "ext.scaffold"
  | "ext.validate"
  | "ext.package"
  | "ext.install"
  | "ext.remove"
  | "ext.test.run"
  | "ext.test.list"
  | "ext.validateComposition";

export function createDevkitHandlers(_port: DevkitPort): Pick<WireHandlers, DevkitMethods> {
  return {
    "ext.kinds": notImplemented("ext.kinds"),
    "ext.scaffold": notImplemented("ext.scaffold"),
    "ext.validate": notImplemented("ext.validate"),
    "ext.package": notImplemented("ext.package"),
    "ext.install": notImplemented("ext.install"),
    "ext.remove": notImplemented("ext.remove"),
    "ext.test.run": notImplemented("ext.test.run"),
    "ext.test.list": notImplemented("ext.test.list"),
    "ext.validateComposition": notImplemented("ext.validateComposition"),
  };
}
