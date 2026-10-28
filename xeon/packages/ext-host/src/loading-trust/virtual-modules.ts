import { err, ok, type Result } from "@xeon/contracts";

/**
 * 플러그인 번들이 호스트와 같은 인스턴스를 쓰게 하는 SDK 가상 모듈의 지정자(X.loading-trust.spec §4.4.5).
 * 조립 루트는 이 지정자마다 호스트가 쓰는 모듈 객체를 넘긴다
 */
export const SDK_MODULE_SPECIFIERS: readonly ["@xeon/contracts", "@xeon/group-kit", "typebox"] = [
  "@xeon/contracts",
  "@xeon/group-kit",
  "typebox",
];

/** 지정자 → 호스트의 모듈 객체(보통 `import * as ns`의 결과) */
export type SdkModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export type SdkRegisterError =
  /** Bun 런타임이 아니라서 `Bun.plugin`이 없다 */
  | { readonly kind: "unavailable" }
  /** 같은 지정자에 다른 모듈 객체가 이미 등록되어 있다. 등록은 프로세스 전역이고 첫 import 뒤에는 바꿀 수 없다 */
  | { readonly kind: "conflict"; readonly specifier: string };

/** 프로세스 전역 등록부. `Bun.plugin`의 모듈 등록이 프로세스 전역이라 같은 곳에 둔다 */
const registered = new Map<string, Readonly<Record<string, unknown>>>();

/**
 * SDK 가상 모듈을 등록한다. 같은 객체를 다시 등록하면 아무 일도 하지 않는다(멱등). 다른 객체를 같은 지정자에
 * 등록하려 하면 아무것도 등록하지 않고 `conflict`를 돌려준다. 등록 뒤에 import하는 모듈부터 적용된다
 */
export function registerSdkModules(modules: SdkModules): Result<void, SdkRegisterError> {
  const entries = Object.entries(modules);
  if (entries.length === 0) return ok(undefined);
  for (const [specifier, exports] of entries) {
    const existing = registered.get(specifier);
    if (existing !== undefined && existing !== exports) {
      return err({ kind: "conflict", specifier });
    }
  }
  if (typeof Bun === "undefined") return err({ kind: "unavailable" });
  for (const [specifier, exports] of entries) {
    if (registered.has(specifier)) continue;
    // 등록이 던지면 기록을 남기지 않는다. 기록은 `Bun.plugin`이 끝난 뒤에만 한다
    Bun.plugin({
      name: `xeon-sdk:${specifier}`,
      setup(build) {
        build.module(specifier, () => ({ exports, loader: "object" }));
      },
    });
    registered.set(specifier, exports);
  }
  return ok(undefined);
}
