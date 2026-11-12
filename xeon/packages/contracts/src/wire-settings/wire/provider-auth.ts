import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import { ProviderIdSchema } from "../../capabilities/index.ts";

// 제공자 인증 확인(M4, `provider.checkAuth`, `L1.models.spec` §3.13). 사용자가 연결 시험을 누른 설정 동작이다.
// 저장된 키로 제공자의 값 없는 GET 하나를 보낸다. 결과에는 키 값이 없고, `reason`은 키 값을 `••••`로 가린 글이다.

/** provider.checkAuth params. `provider`는 `l1.models.providers`의 id다 */
export const ProviderCheckAuthParamsSchema: TObject<{ provider: typeof ProviderIdSchema }> =
  Type.Object({ provider: ProviderIdSchema }, { additionalProperties: false });
export type ProviderCheckAuthParams = Static<typeof ProviderCheckAuthParamsSchema>;

/** 결과 종류. 집합은 `ProviderAuthKind`(services/models.ts)와 같다 */
export const ProviderAuthKindSchema: TUnion<
  [
    TLiteral<"ok">,
    TLiteral<"rejected">,
    TLiteral<"badAddress">,
    TLiteral<"quotaOrBilling">,
    TLiteral<"upstream">,
    TLiteral<"timeout">,
    TLiteral<"unsupported">,
    TLiteral<"oauthTokenNotApiKey">,
    TLiteral<"noKey">,
  ]
> = Type.Union([
  Type.Literal("ok"),
  Type.Literal("rejected"),
  Type.Literal("badAddress"),
  Type.Literal("quotaOrBilling"),
  Type.Literal("upstream"),
  Type.Literal("timeout"),
  Type.Literal("unsupported"),
  Type.Literal("oauthTokenNotApiKey"),
  Type.Literal("noKey"),
]);

/** provider.checkAuth result. `status`는 응답이 왔을 때만, `reason`은 200자 이내의 사유 글이다 */
export const ProviderCheckAuthResultSchema: TObject<{
  kind: typeof ProviderAuthKindSchema;
  status: TOptional<TInteger>;
  reason: TOptional<TString>;
}> = Type.Object(
  {
    kind: ProviderAuthKindSchema,
    status: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
    reason: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type ProviderCheckAuthResult = Static<typeof ProviderCheckAuthResultSchema>;
