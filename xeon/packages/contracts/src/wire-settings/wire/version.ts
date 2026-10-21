import {
  Type,
  type Static,
  type TLiteral,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import { SemVerSchema, type SemVer } from "../../capabilities/index.ts";

/** 호스트 계약(wire)과 설정 정의 형식(settings)이 공유하는 계약 버전 */
export const WIRE_PROTOCOL_VERSION: SemVer = "0.1.0";

export const FeatureStatusSchema: TUnion<
  [TLiteral<"experimental">, TLiteral<"active">, TLiteral<"deprecated">, TLiteral<"removed">]
> = Type.Union([
  Type.Literal("experimental"),
  Type.Literal("active"),
  Type.Literal("deprecated"),
  Type.Literal("removed"),
]);
export type FeatureStatus = Static<typeof FeatureStatusSchema>;

/** 메서드 이름 또는 "<영역>.<기능>" */
export const FeatureNameSchema: TString = Type.String({ minLength: 1, maxLength: 96 });
export type FeatureName = Static<typeof FeatureNameSchema>;

export const FeatureInfoSchema: TObject<{
  name: typeof FeatureNameSchema;
  status: typeof FeatureStatusSchema;
  since: typeof SemVerSchema;
  deprecatedIn: TOptional<typeof SemVerSchema>;
  removeAfter: TOptional<TString>;
  replacedBy: TOptional<typeof FeatureNameSchema>;
}> = Type.Object(
  {
    name: FeatureNameSchema,
    status: FeatureStatusSchema,
    since: SemVerSchema,
    deprecatedIn: Type.Optional(SemVerSchema),
    removeAfter: Type.Optional(Type.String({ format: "date", maxLength: 10 })),
    replacedBy: Type.Optional(FeatureNameSchema),
  },
  { additionalProperties: false },
);
export type FeatureInfo = Static<typeof FeatureInfoSchema>;

const CORE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function majorMinor(version: string): { major: number; minor: number } | undefined {
  const match = CORE_VERSION.exec(version);
  if (match === null) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * 순수 함수. 주 버전이 같으면 호환이다. 0.x 동안은 부 버전까지 같아야 한다.
 * 형식이 틀린 버전은 호환이 아니다. 매개변수는 와이어에서 온 문자열이라 SemVer 대신 string이다.
 */
export function isCompatible(client: string, server: string): boolean {
  const c = majorMinor(client);
  const s = majorMinor(server);
  if (c === undefined || s === undefined) return false;
  if (c.major !== s.major) return false;
  return c.major === 0 ? c.minor === s.minor : true;
}
