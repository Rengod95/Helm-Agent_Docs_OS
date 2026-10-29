import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import { IsoDateSchema, ProviderIdSchema } from "../../capabilities/index.ts";

// 웹 provider 상태 목록(M3-REQ-96, `web.providers`). 읽기 전용이고 비밀 값을 싣지 않는다.
// 호스트가 cap-web의 카탈로그와 탐침 캐시에서 채운다(L4.host-service). `unavailable.reason`은 `ProviderUnavailableReason` 문자열이다.

/** web.providers params. 선택 필드가 없고 `_meta`만 레지스트리가 더한다 */
export const WebProvidersParamsSchema: TObject<{}> = Type.Object(
  {},
  { additionalProperties: false },
);
export type WebProvidersParams = Static<typeof WebProvidersParamsSchema>;

/** 웹 능력 가운데 provider가 맡는 셋 */
export const WebProviderCapabilitySchema: TUnion<
  [TLiteral<"web.search">, TLiteral<"web.fetch">, TLiteral<"web.browse">]
> = Type.Union([Type.Literal("web.search"), Type.Literal("web.fetch"), Type.Literal("web.browse")]);
export type WebProviderCapability = Static<typeof WebProviderCapabilitySchema>;

/** provider 출처. `ProviderOrigin`(capabilities/provider.ts)과 같은 값이다 */
export const WebProviderOriginSchema: TUnion<
  [TLiteral<"plugin">, TLiteral<"detected">, TLiteral<"builtin">]
> = Type.Union([Type.Literal("plugin"), Type.Literal("detected"), Type.Literal("builtin")]);
export type WebProviderOrigin = Static<typeof WebProviderOriginSchema>;

/** 인증 방식. `WebProviderManifest.auth.kind`와 같은 값이다. 키 값과 주입 위치는 싣지 않는다 */
export const WebProviderAuthSchema: TUnion<
  [TLiteral<"none">, TLiteral<"header">, TLiteral<"bearer">, TLiteral<"query">]
> = Type.Union([
  Type.Literal("none"),
  Type.Literal("header"),
  Type.Literal("bearer"),
  Type.Literal("query"),
]);
export type WebProviderAuth = Static<typeof WebProviderAuthSchema>;

/** 탐침 상태. `unavailable.reason`의 값 집합은 `ProviderUnavailableReason`(capabilities/defs/web-provider.ts)이 정한다 */
export const WebProviderStateSchema: TUnion<
  [
    TObject<{ kind: TLiteral<"ok"> }>,
    TObject<{ kind: TLiteral<"unavailable">; reason: TString; detail: TOptional<TString> }>,
  ]
> = Type.Union([
  Type.Object({ kind: Type.Literal("ok") }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("unavailable"),
      reason: Type.String({ maxLength: 64 }),
      detail: Type.Optional(Type.String({ maxLength: 512 })),
    },
    { additionalProperties: false },
  ),
]);
export type WebProviderState = Static<typeof WebProviderStateSchema>;

/** provider 한 건의 상태 */
export const WebProviderStatusSchema: TObject<{
  id: typeof ProviderIdSchema;
  capability: typeof WebProviderCapabilitySchema;
  origin: typeof WebProviderOriginSchema;
  displayName: TString;
  auth: typeof WebProviderAuthSchema;
  status: typeof WebProviderStateSchema;
  pricingAsOf: TUnion<[TString, TNull]>;
  pricingStale: TBoolean;
  firstUseNoticed: TBoolean;
  autoRank: TUnion<[TInteger, TNull]>;
}> = Type.Object(
  {
    id: ProviderIdSchema,
    capability: WebProviderCapabilitySchema,
    origin: WebProviderOriginSchema,
    displayName: Type.String({ minLength: 1, maxLength: 64 }),
    auth: WebProviderAuthSchema,
    status: WebProviderStateSchema,
    /** 가격표 기준일(ISO 날짜). 가격표가 없거나 무료면 null이다 */
    pricingAsOf: Nullable(IsoDateSchema),
    /** 가격표 기준일이 오래되었으면 참이다 */
    pricingStale: Type.Boolean(),
    /** 고지가 필요 없는 provider(인증 `none`)거나 사용자의 첫 사용 고지를 이미 보였으면 참이다 */
    firstUseNoticed: Type.Boolean(),
    /**
     * 자동 선택(`auto`)이 이 provider를 시도하는 순서에서의 0부터 센 자리다. 설정 provider가 `auto`가 아니어도 이 값은 자동 순서 기준이다.
     * 웹 fetch 행은 사용자 순서가 없으므로 null이다.
     */
    autoRank: Nullable(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type WebProviderStatus = Static<typeof WebProviderStatusSchema>;

/** 웹 설정의 유효 값이다. 설정 정의와 기본값은 `L2.web.spec`이 정한다 */
export const WebSettingsWireSchema: TObject<{
  searchProvider: TString;
  searchOrder: TArray<TString>;
  searchParallel: TInteger;
  browseProvider: TString;
  browseOrder: TArray<TString>;
  robots: TUnion<[TLiteral<"auto">, TLiteral<"always">, TLiteral<"never">]>;
}> = Type.Object(
  {
    searchProvider: Type.String({ minLength: 1, maxLength: 96 }),
    searchOrder: Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { maxItems: 64 }),
    searchParallel: Type.Integer({ minimum: 1, maximum: 4 }),
    browseProvider: Type.String({ minLength: 1, maxLength: 96 }),
    browseOrder: Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { maxItems: 64 }),
    robots: Type.Union([Type.Literal("auto"), Type.Literal("always"), Type.Literal("never")]),
  },
  { additionalProperties: false },
);
export type WebSettingsWire = Static<typeof WebSettingsWireSchema>;

/** web.providers result. 목록과 웹 설정 현재 값을 함께 싣는다 */
export const WebProvidersResultSchema: TObject<{
  providers: TArray<typeof WebProviderStatusSchema>;
  settings: typeof WebSettingsWireSchema;
}> = Type.Object(
  {
    providers: Type.Array(WebProviderStatusSchema, { maxItems: 64 }),
    settings: WebSettingsWireSchema,
  },
  { additionalProperties: false },
);
export type WebProvidersResult = Static<typeof WebProvidersResultSchema>;
