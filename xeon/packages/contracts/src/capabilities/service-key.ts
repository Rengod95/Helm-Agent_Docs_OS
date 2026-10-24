import type { AnyCapabilityDef, CapabilityApi } from "./capability.ts";
import type { CapabilityId, SemVer } from "./ids.ts";

declare const serviceApiType: unique symbol;

/** 서비스 API 타입을 실어 나르는 브랜드 토큰. 런타임 값은 capability와 version뿐이다 */
export interface ServiceKey<Api> {
  readonly capability: CapabilityId;
  readonly version: SemVer;
  /** 팬텀 필드. 런타임에는 없다 */
  readonly [serviceApiType]?: Api;
}

export type ApiOf<K> = K extends ServiceKey<infer Api> ? Api : never;

/** 정의에서 서비스 키를 만든다. 순수 함수. F는 Cordis를 import하지 않는다 */
export function serviceKey<const D extends AnyCapabilityDef>(def: D): ServiceKey<CapabilityApi<D>> {
  return { capability: def.id, version: def.version };
}
