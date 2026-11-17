import { assertNever, type Result } from "@fresnel/contracts";
import {
  wireError,
  type PluginGetResult,
  type PluginListFilter,
  type PluginListResult,
  type PluginScanResult,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import { wireErrorOfProfile, type ProfilePortFailure } from "../m4/profile-test-run.ts";

// 플러그인 읽기 wire(M5c §3.4 `plugin.list`, `plugin.get`, `plugin.scan`). 처리기는 포트가 돌려준 값을 그대로 옮기고 오류만 wire 오류로 바꾼다.
// 계산(카드 만들기, 원본 폴더 읽기, 사용처 계산, 저장소 읽기)은 `assembly/plugins/service.ts`가 한다.
// 나머지 `plugin.*`과 `pluginReview.*`는 `handlers/index.ts`에서 아직 `notImplemented`다.

/** 포트가 돌려주는 거절. 처리기가 wire 오류로 옮긴다 */
export type PluginPortFailure =
  /** 그 이름의 플러그인이 없다(`extension.notFound`, 기존 오류를 쓴다 §3.4) */
  | { readonly kind: "unknown_plugin"; readonly name: string }
  /** 프로필 목록을 읽지 못해 사용처를 계산할 수 없다. 프로필 오류를 그대로 옮긴다 */
  | { readonly kind: "profiles"; readonly failure: ProfilePortFailure }
  /** 검토본 저장소를 읽지 못했다. `code`는 저장소 오류의 종류다(`store.io`로 옮긴다) */
  | { readonly kind: "store"; readonly code: string };

/** 처리기가 쓰는 포트. 메서드 하나가 wire 메서드 하나다 */
export interface PluginPort {
  list(filter: PluginListFilter): Promise<Result<PluginListResult, PluginPortFailure>>;
  get(name: string): Promise<Result<PluginGetResult, PluginPortFailure>>;
  /** 원본 폴더를 다시 훑는다. 새 검토 항목은 만들지 않는다(다음 층) */
  scan(): Promise<Result<PluginScanResult, PluginPortFailure>>;
}

export type PluginMethods = "plugin.list" | "plugin.get" | "plugin.scan";

function wireErrorOf(failure: PluginPortFailure): WireError {
  switch (failure.kind) {
    case "unknown_plugin":
      return wireError("extension.notFound", { details: { name: failure.name } });
    case "profiles":
      return wireErrorOfProfile(failure.failure);
    case "store":
      return wireError("store.io", {
        message: "the plugin store cannot be read",
        details: { code: failure.code.slice(0, 64) },
      });
    default:
      return assertNever(failure, "PluginPortFailure");
  }
}

async function unwrap<T>(call: Promise<Result<T, PluginPortFailure>>): Promise<T> {
  const result = await call;
  if (!result.ok) throw wireErrorOf(result.error);
  return result.value;
}

export function createPluginHandlers(port: PluginPort): Pick<WireHandlers, PluginMethods> {
  return {
    "plugin.list": (params) => unwrap(port.list(params.filter ?? {})),
    "plugin.get": (params) => unwrap(port.get(params.name)),
    "plugin.scan": () => unwrap(port.scan()),
  };
}
