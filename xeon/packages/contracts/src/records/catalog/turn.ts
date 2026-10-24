import {
  Type,
  type Static,
  type TBoolean,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";
import { Nullable } from "../../base/index.ts";

/** 취소 의도. turn.updated가 휘발이라 따로 둔다(L1.tasks.spec §3.8). */
export const TurnAbortRequestedPayloadSchema: TObject<{
  reason: TObject<{
    code: TUnion<
      [
        TLiteral<"user">,
        TLiteral<"parent">,
        TLiteral<"lease_revoked">,
        TLiteral<"budget">,
        TLiteral<"lease_lost">,
        TLiteral<"error">,
      ]
    >;
    message: TUnion<[TString, TNull]>;
  }>;
  cause: TUnion<[TLiteral<"direct">, TLiteral<"cascade">]>;
  background: TBoolean;
}> = Type.Object(
  {
    reason: Type.Object(
      {
        code: Type.Union([
          Type.Literal("user"),
          Type.Literal("parent"),
          Type.Literal("lease_revoked"),
          Type.Literal("budget"),
          Type.Literal("lease_lost"),
          Type.Literal("error"),
        ]),
        message: Nullable(Type.String({ maxLength: 1000 })),
      },
      { additionalProperties: false },
    ),
    cause: Type.Union([Type.Literal("direct"), Type.Literal("cascade")]),
    /** 백그라운드 경계를 넘는 취소였는지 */
    background: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TurnAbortRequestedPayload = Static<typeof TurnAbortRequestedPayloadSchema>;
