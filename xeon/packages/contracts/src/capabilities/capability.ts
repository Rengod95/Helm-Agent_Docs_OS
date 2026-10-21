import type { Static } from "typebox";
import type { CapabilityId, SemVer } from "./ids.ts";
import type { CallOptions, MethodMap, ServiceDef } from "./method.ts";
import type { ToolSpec, ToolSpecFor } from "./tool-spec.ts";

export type {
  CallContext,
  CallerInfo,
  CallOptions,
  ErrorDecl,
  MethodDef,
  MethodFn,
  MethodMap,
  ServiceDef,
} from "./method.ts";

export interface CapabilityDef<
  Ms extends MethodMap = MethodMap,
  Ts extends readonly ToolSpecFor<Ms>[] = readonly ToolSpecFor<Ms>[],
> {
  readonly id: CapabilityId;
  readonly version: SemVer;
  readonly description: string;
  readonly service: ServiceDef<Ms>;
  /** 모델 도구 목록. 빈 배열 허용 */
  readonly tools: Ts;
  /** 이 능력의 정의가 전제하는 다른 능력. provider 등록 시 X가 해석한다 */
  readonly requires?: readonly CapabilityId[];
}

export type AnyCapabilityDef = CapabilityDef<MethodMap, readonly ToolSpec[]>;

/** 정의에서 유도되는 서비스 API 타입. consumer는 이 타입만 쓴다 */
export type CapabilityApi<D extends AnyCapabilityDef> = {
  readonly [K in keyof D["service"]["methods"] & string]: (
    input: Static<D["service"]["methods"][K]["input"]>,
    options?: CallOptions,
  ) => Promise<Static<D["service"]["methods"][K]["output"]>>;
};

/**
 * 항등 함수. 타입 추론만 한다. 런타임 검사를 하지 않는다(검사는 validateCapability).
 * const 타입 매개변수로 method 리터럴과 스키마 타입을 보존한다.
 */
export function defineCapability<
  const Ms extends MethodMap,
  const Ts extends readonly ToolSpecFor<Ms>[],
>(def: CapabilityDef<Ms, Ts>): CapabilityDef<Ms, Ts> {
  return def;
}
