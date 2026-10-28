import { expect, test } from "bun:test";
import { serviceKey, type ApiOf, type ServiceKey } from "../../src/capabilities/index.ts";
import type { ScopeApi } from "../../src/extensions/index.ts";
import type { Equal, Expect } from "../types/expect.ts";
import { WebSearch, WebSearchKey } from "./fixtures/web-search.ts";

// M3-REQ-13, A-01 A안: F는 ServiceKey<Api>만 둔다. Cordis 선언 병합과 공급자 등록(provide)은 F에 없다.

test("a service key is a plain value of capability id and version", () => {
  expect(Object.keys(serviceKey(WebSearch)).toSorted()).toEqual(["capability", "version"]);
  expect(WebSearchKey).toEqual({ capability: WebSearch.id, version: WebSearch.version });
});

test("ApiOf recovers the API type carried by the key", () => {
  type Api = ApiOf<typeof WebSearchKey>;
  type FromKey<K> = K extends ServiceKey<infer A> ? A : never;
  const same: Expect<Equal<Api, FromKey<typeof WebSearchKey>>> = true;
  const search: Expect<Equal<keyof Api, "search">> = true;
  expect([same, search]).toEqual([true, true]);
});

test("ScopeApi has capability but no provide (X hostOf(g).provide owns registration)", () => {
  type Keys = keyof ScopeApi<unknown>;
  const hasCapability: Expect<Equal<"capability" extends Keys ? true : false, true>> = true;
  const hasNoProvide: Expect<Equal<"provide" extends Keys ? true : false, false>> = true;
  expect([hasCapability, hasNoProvide]).toEqual([true, true]);
});
