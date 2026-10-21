import {
  Type,
  type Static,
  type TArray,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import { EventIdSchema, type EventId } from "../../conversation/index.ts";

// L0.secrets.spec §3.9. 값, 값의 일부, 값의 해시를 싣지 않는다.
// capabilities의 SecretAuditRecord와 필드 이름이 같아야 한다. records는 capabilities를 import하지 않으므로
// 같은 모양을 적고, 일치는 test/records/secret-alignment.test.ts가 확인한다.

const SecretUseModeJson: TUnion<
  [TLiteral<"env">, TLiteral<"sentinel">, TLiteral<"runtime-http">, TLiteral<"browser-input">]
> = Type.Union([
  Type.Literal("env"),
  Type.Literal("sentinel"),
  Type.Literal("runtime-http"),
  Type.Literal("browser-input"),
]);

const handle = (): TString =>
  Type.String({ pattern: "^secret://[a-z][a-z0-9-]{1,63}$", maxLength: 75 });
const at = (): TInteger => Type.Integer({ minimum: 0 });

export const SecretUsedPayloadSchema: TObject<{
  handle: TString;
  mode: typeof SecretUseModeJson;
  toolCallId: TUnion<[TString, TNull]>;
  host: TUnion<[TString, TNull]>;
  commandHash: TUnion<[TString, TNull]>;
  leaseId: TString;
  at: TInteger;
}> = Type.Object(
  {
    handle: handle(),
    mode: SecretUseModeJson,
    toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
    host: Nullable(Type.String({ minLength: 1, maxLength: 253 })),
    /** 명령줄 문자열의 SHA-256 hex 앞 16자 */
    commandHash: Nullable(Type.String({ pattern: "^[0-9a-f]{16}$", maxLength: 16 })),
    leaseId: Type.String({ minLength: 1, maxLength: 128 }),
    at: at(),
  },
  { additionalProperties: false },
);
export type SecretUsedPayload = Static<typeof SecretUsedPayloadSchema>;

export const SecretDeniedPayloadSchema: TObject<{
  handle: TString;
  mode: typeof SecretUseModeJson;
  reason: TString;
  purpose: TString;
  toolCallId: TUnion<[TString, TNull]>;
  at: TInteger;
}> = Type.Object(
  {
    handle: handle(),
    mode: SecretUseModeJson,
    /** 값 집합은 L0.secrets.spec SecretDenyReason */
    reason: Type.String({ minLength: 1, maxLength: 64 }),
    purpose: Type.String({ maxLength: 500 }),
    toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
    at: at(),
  },
  { additionalProperties: false },
);
export type SecretDeniedPayload = Static<typeof SecretDeniedPayloadSchema>;

export const SecretApprovedPayloadSchema: TObject<{
  handle: TString;
  scope: TUnion<[TLiteral<"per-session">, TLiteral<"per-use">]>;
  approvalId: TUnsafe<EventId>;
  expiresAt: TUnion<[TInteger, TNull]>;
  at: TInteger;
}> = Type.Object(
  {
    handle: handle(),
    scope: Type.Union([Type.Literal("per-session"), Type.Literal("per-use")]),
    approvalId: EventIdSchema,
    expiresAt: Nullable(Type.Integer({ minimum: 0 })),
    at: at(),
  },
  { additionalProperties: false },
);
export type SecretApprovedPayload = Static<typeof SecretApprovedPayloadSchema>;

const MaskHit: TObject<{ kind: TString; count: TInteger }> = Type.Object(
  {
    kind: Type.String({ minLength: 1, maxLength: 96 }),
    count: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SecretMaskedPayloadSchema: TObject<{
  hits: TArray<typeof MaskHit>;
  layer: TUnion<
    [
      TLiteral<"human-input">,
      TLiteral<"tool-result">,
      TLiteral<"outbound">,
      TLiteral<"model-projection">,
      TLiteral<"ops-log">,
    ]
  >;
  at: TInteger;
}> = Type.Object(
  {
    hits: Type.Array(MaskHit, { maxItems: 64 }),
    layer: Type.Union([
      Type.Literal("human-input"),
      Type.Literal("tool-result"),
      Type.Literal("outbound"),
      Type.Literal("model-projection"),
      Type.Literal("ops-log"),
    ]),
    at: at(),
  },
  { additionalProperties: false },
);
export type SecretMaskedPayload = Static<typeof SecretMaskedPayloadSchema>;
