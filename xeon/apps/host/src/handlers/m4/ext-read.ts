import { assertNever, type Result } from "@fresnel/contracts";
import {
  wireError,
  type WireError,
  type WireHandlers,
  type WireMethodName,
  type WireParams,
  type WireResult,
} from "@fresnel/contracts/wire";

// 확장 읽기 wire(`spec-deltas/t-wa.md` §1). 처리기는 포트가 돌려준 값을 그대로 옮기고 오류만 wire 오류로 바꾼다.
// 값을 새로 계산하지 않는다(§2 1번). 계산(층 합치기, 출처 판정, 엣지 만들기)은 `assembly/m4/ext-read-port.ts`가 한다.

/** 포트가 돌려주는 거절. 처리기가 wire 오류로 옮긴다 */
type ExtReadError =
  | { readonly kind: "unknown_extension"; readonly name: string }
  | { readonly kind: "unknown_group"; readonly id: string }
  | { readonly kind: "unknown_thread"; readonly threadId: string }
  | { readonly kind: "unknown_setting"; readonly key: string }
  /** 안전 모드에서 `ext.reenable`, `ext.reload`를 거부한다(§2 2번 [제안]) */
  | { readonly kind: "safe_mode_active" }
  /** `managed` 범위가 잠근 확장은 자동 끔을 풀 수 없다 */
  | { readonly kind: "managed_locked"; readonly name: string };

export type ExtReadResult<T> = Result<T, ExtReadError>;

type PortCall<M extends WireMethodName> = (
  params: WireParams<M>,
  signal: AbortSignal,
) => Promise<ExtReadResult<WireResult<M>>>;

/** 처리기가 쓰는 포트. 메서드 하나가 wire 메서드 하나다 */
export interface ExtReadPort {
  readonly list: PortCall<"ext.list">;
  readonly get: PortCall<"ext.get">;
  readonly reenable: PortCall<"ext.reenable">;
  readonly reload: PortCall<"ext.reload">;
  readonly health: PortCall<"ext.health">;
  readonly timings: PortCall<"ext.timings">;
  readonly bindings: PortCall<"ext.bindings">;
  readonly groupList: PortCall<"group.list">;
  readonly groupMetrics: PortCall<"group.metrics">;
  readonly groupPromotion: PortCall<"group.promotion">;
  readonly groupDriveLock: PortCall<"group.driveLock">;
  readonly hooks: PortCall<"hooks.list">;
  readonly settingExplain: PortCall<"settings.explain">;
}

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

function wireErrorOf(error: ExtReadError): WireError {
  switch (error.kind) {
    case "unknown_extension":
      return wireError("extension.notFound", { details: { name: error.name } });
    case "unknown_group":
      return wireError("group.notFound", { details: { id: error.id } });
    case "unknown_thread":
      return wireError("thread.notFound", { details: { threadId: error.threadId } });
    case "unknown_setting":
      return wireError("settings.unknownKey", { details: { key: error.key } });
    case "safe_mode_active":
      return wireError("extension.safeModeActive");
    case "managed_locked":
      return wireError("settings.locked", {
        details: { key: `ext.${error.name}.enabled`, lockedBy: "managed" },
      });
    default:
      return assertNever(error, "ExtReadError");
  }
}

async function unwrap<T>(call: Promise<ExtReadResult<T>>): Promise<T> {
  const result = await call;
  if (!result.ok) throw wireErrorOf(result.error);
  return result.value;
}

export function createExtReadHandlers(port: ExtReadPort): Pick<WireHandlers, ExtReadMethods> {
  return {
    "ext.list": (params, context) => unwrap(port.list(params, context.signal)),
    "ext.get": (params, context) => unwrap(port.get(params, context.signal)),
    "ext.reenable": (params, context) => unwrap(port.reenable(params, context.signal)),
    "ext.reload": (params, context) => unwrap(port.reload(params, context.signal)),
    "ext.health": (params, context) => unwrap(port.health(params, context.signal)),
    "ext.timings": (params, context) => unwrap(port.timings(params, context.signal)),
    "ext.bindings": (params, context) => unwrap(port.bindings(params, context.signal)),
    "group.list": (params, context) => unwrap(port.groupList(params, context.signal)),
    "group.metrics": (params, context) => unwrap(port.groupMetrics(params, context.signal)),
    "group.promotion": (params, context) => unwrap(port.groupPromotion(params, context.signal)),
    "group.driveLock": (params, context) => unwrap(port.groupDriveLock(params, context.signal)),
    "hooks.list": (params, context) => unwrap(port.hooks(params, context.signal)),
    "settings.explain": (params, context) => unwrap(port.settingExplain(params, context.signal)),
  };
}
