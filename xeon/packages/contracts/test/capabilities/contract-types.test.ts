import { test } from "bun:test";
import type { Static } from "typebox";
import {
  defineCapability,
  type ApiOf,
  type CallOptions,
  type SecretMeta,
  type SecretMetaSchema,
  type SecretUsePolicy,
  type SecretUsePolicySchema,
  type ToolWire,
} from "../../src/capabilities/index.ts";
import type { Tool } from "../../src/conversation/index.ts";
import type { Assignable, Equal, Expect } from "../types/expect.ts";
import type { WebSearchInput, WebSearchKey, WebSearchOutput } from "./fixtures/web-search.ts";

// 이 파일의 단언은 tsc -b가 판정한다(컴파일 시점). 아래 테스트는 파일이 bun test와 knip 진입점에 들게 한다.

/** consumer는 provider 패키지 없이 정의와 서비스 키만으로 호출 타입을 추론한다 */
type SearchApi = ApiOf<typeof WebSearchKey>;
type ExpectedParameters = [input: Static<typeof WebSearchInput>, options?: CallOptions];
export type SearchParameters = Expect<
  Assignable<ExpectedParameters, Parameters<SearchApi["search"]>>
>;
export type SearchInput = Expect<
  Equal<Parameters<SearchApi["search"]>[0], Static<typeof WebSearchInput>>
>;
export type SearchReturn = Expect<
  Equal<Awaited<ReturnType<SearchApi["search"]>>, Static<typeof WebSearchOutput>>
>;
export type OnlyDeclaredMethods = Expect<Equal<keyof SearchApi, "search">>;

/** 없는 메서드 이름은 컴파일 오류다 */
export function methodKeyIsChecked(): void {
  defineCapability({
    id: "web.broken",
    version: "1.0.0",
    description: "d",
    service: { methods: {} },
    tools: [
      // @ts-expect-error -- service.methods에 없는 메서드는 타입 검사 단계에서 거부된다 (F.capabilities.spec §9 2)
      { name: "broken", label: "b", description: "d", method: "nope", parameters: WebSearchInput },
    ],
  });
}

/** ToolWire는 pi Tool에 대입 가능하다 */
export type WireIsTool = Expect<Assignable<ToolWire, Tool>>;

/** 비밀 메타: 스키마의 Static과 인터페이스는 서로 대입 가능하다(읽기 전용 차이는 허용) */
type MutableValue<V> = V extends string
  ? V
  : V extends readonly (infer U)[]
    ? MutableValue<U>[]
    : V extends object
      ? Mutable<V>
      : V;
type Mutable<T> = { -readonly [K in keyof T]: MutableValue<T[K]> };
export type PolicySchemaToInterface = Expect<
  Assignable<Static<typeof SecretUsePolicySchema>, SecretUsePolicy>
>;
export type PolicyInterfaceToSchema = Expect<
  Assignable<Mutable<SecretUsePolicy>, Static<typeof SecretUsePolicySchema>>
>;
export type MetaSchemaToInterface = Expect<Assignable<Static<typeof SecretMetaSchema>, SecretMeta>>;
export type MetaInterfaceToSchema = Expect<
  Assignable<Mutable<SecretMeta>, Static<typeof SecretMetaSchema>>
>;

test("type assertions compile", () => {});
