import type { WireHandlers } from "@fresnel/contracts/wire";
import { notImplemented } from "../not-implemented.ts";

// 확장 읽기 wire. 처리기는 T-WA가 채운다(`spec-deltas/t-wa.md`).
// T-F가 `notImplemented`로 채워 둔 기본 처리기다(`spec-deltas/t-f.md` §5). 소유 트랙(T-WA)이 이 파일과
// `assembly/m4/ext-read-port.ts`만 고쳐서 채운다. `handlers/index.ts`, `types.ts`, `assemble.ts`, `assembly/m4/index.ts`는 고치지 않는다.

/** 처리기가 쓰는 포트. 처음에는 메서드가 없다. T-WA가 메서드를 더한다 */
export type ExtReadPort = Readonly<Record<string, never>>;

export type ExtReadMethods =
  | "ext.list"
  | "ext.get"
  | "ext.reenable"
  | "ext.reload"
  | "ext.health"
  | "ext.timings"
  | "ext.bindings"
  | "group.list"
  | "group.metrics"
  | "group.promotion"
  | "group.driveLock"
  | "hooks.list"
  | "settings.explain";

export function createExtReadHandlers(_port: ExtReadPort): Pick<WireHandlers, ExtReadMethods> {
  return {
    "ext.list": notImplemented("ext.list"),
    "ext.get": notImplemented("ext.get"),
    "ext.reenable": notImplemented("ext.reenable"),
    "ext.reload": notImplemented("ext.reload"),
    "ext.health": notImplemented("ext.health"),
    "ext.timings": notImplemented("ext.timings"),
    "ext.bindings": notImplemented("ext.bindings"),
    "group.list": notImplemented("group.list"),
    "group.metrics": notImplemented("group.metrics"),
    "group.promotion": notImplemented("group.promotion"),
    "group.driveLock": notImplemented("group.driveLock"),
    "hooks.list": notImplemented("hooks.list"),
    "settings.explain": notImplemented("settings.explain"),
  };
}
