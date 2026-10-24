import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TObject,
  type TOptional,
  type TRecord,
  type TString,
  type TUnion,
} from "typebox";
import { CapabilityIdSchema, SemVerRangeSchema, SemVerSchema } from "../capabilities/index.ts";
import { RECORD_KIND_READ_PATTERN, RecordKindDeclJsonSchema } from "./group-record.ts";
import { ExtensionNameSchema } from "./name.ts";
import { PointNameSchema } from "./points.ts";

export { EXTENSION_NAME_PATTERN, ExtensionNameSchema, type ExtensionName } from "./name.ts";

export const ExtensionLayerSchema: TUnion<
  [TLiteral<"L1">, TLiteral<"L2">, TLiteral<"L3">, TLiteral<"plugin">]
> = Type.Union([
  Type.Literal("L1"),
  Type.Literal("L2"),
  Type.Literal("L3"),
  Type.Literal("plugin"),
]);

export const ExtensionKindSchema: TUnion<[TLiteral<"plugin">, TLiteral<"group">]> = Type.Union([
  Type.Literal("plugin"),
  Type.Literal("group"),
]);

export const CapabilityRequirementSchema: TObject<{
  id: typeof CapabilityIdSchema;
  range: typeof SemVerRangeSchema;
}> = Type.Object(
  { id: CapabilityIdSchema, range: SemVerRangeSchema },
  { additionalProperties: false },
);
export type CapabilityRequirement = Static<typeof CapabilityRequirementSchema>;

export const CapabilityProvisionSchema: TObject<{
  id: typeof CapabilityIdSchema;
  version: typeof SemVerSchema;
}> = Type.Object(
  { id: CapabilityIdSchema, version: SemVerSchema },
  { additionalProperties: false },
);
export type CapabilityProvision = Static<typeof CapabilityProvisionSchema>;

/** [가정] 등급 이름은 X.loading-trust.spec이 확정한다 */
export const TrustRequestSchema: TObject<{
  level: TUnion<
    [TLiteral<"builtin">, TLiteral<"user">, TLiteral<"project">, TLiteral<"untrusted">]
  >;
  reason: TOptional<TString>;
}> = Type.Object(
  {
    level: Type.Union([
      Type.Literal("builtin"),
      Type.Literal("user"),
      Type.Literal("project"),
      Type.Literal("untrusted"),
    ]),
    reason: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);
export type TrustRequest = Static<typeof TrustRequestSchema>;

/** 사용자 설정 항목. 값의 스키마와 저장 위치는 F.wire-settings.spec의 설정 키가 정한다 */
export const UserConfigEntrySchema: TObject<{
  setting: TString;
  title: TString;
  description: TOptional<TString>;
  sensitive: TOptional<TBoolean>;
  required: TOptional<TBoolean>;
}> = Type.Object(
  {
    /** F.wire-settings.spec 설정 키. 형식 "ext.<name>.<key>"(F.wire-settings.spec §3.8.1, §3.8.3) */
    setting: Type.String({ minLength: 1, maxLength: 128 }),
    title: Type.String({ minLength: 1, maxLength: 64 }),
    description: Type.Optional(Type.String({ maxLength: 1024 })),
    /** 참이면 값은 비밀 참조(secret://)로만 저장한다(L0.secrets.spec) */
    sensitive: Type.Optional(Type.Boolean()),
    required: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type UserConfigEntry = Static<typeof UserConfigEntrySchema>;

const StringListSchema: TArray<TString> = Type.Array(Type.String({ maxLength: 512 }), {
  maxItems: 256,
});

export const ManifestAuthorSchema: TObject<{
  name: TString;
  email: TOptional<TString>;
  url: TOptional<TString>;
}> = Type.Object(
  {
    name: Type.String({ maxLength: 128 }),
    email: Type.Optional(Type.String({ maxLength: 256 })),
    url: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);

/** Claude Code 구성요소 경로. 해석은 X */
export const ManifestComponentsSchema: TObject<{
  skills: TOptional<typeof StringListSchema>;
  commands: TOptional<typeof StringListSchema>;
  agents: TOptional<typeof StringListSchema>;
  mcpServers: TOptional<TString>;
}> = Type.Object(
  {
    skills: Type.Optional(StringListSchema),
    commands: Type.Optional(StringListSchema),
    agents: Type.Optional(StringListSchema),
    mcpServers: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);

/** Claude Code plugin.json의 레이아웃과 메타 필드를 따르고 Xeon 필드를 더한다 */
export const ExtensionManifestSchema: TObject<{
  schemaVersion: TLiteral<1>;
  name: typeof ExtensionNameSchema;
  version: typeof SemVerSchema;
  displayName: TOptional<TString>;
  description: TOptional<TString>;
  author: TOptional<typeof ManifestAuthorSchema>;
  homepage: TOptional<TString>;
  repository: TOptional<TString>;
  license: TOptional<TString>;
  keywords: TOptional<TArray<TString>>;
  defaultEnabled: TOptional<TBoolean>;
  components: TOptional<typeof ManifestComponentsSchema>;
  userConfig: TOptional<TRecord<"^.*$", typeof UserConfigEntrySchema>>;
  layer: typeof ExtensionLayerSchema;
  kind: typeof ExtensionKindSchema;
  entry: TString;
  requires: TOptional<TArray<typeof CapabilityRequirementSchema>>;
  optional: TOptional<TArray<typeof CapabilityRequirementSchema>>;
  provides: TOptional<TArray<typeof CapabilityProvisionSchema>>;
  points: TArray<typeof PointNameSchema>;
  usesPost: TOptional<TBoolean>;
  usesDrive: TBoolean;
  recordKinds: TOptional<TArray<typeof RecordKindDeclJsonSchema>>;
  readsRecordKinds: TOptional<TArray<TString>>;
  isolation: TOptional<TUnion<[TLiteral<"none">, TLiteral<"process">]>>;
  trust: TOptional<typeof TrustRequestSchema>;
}> = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    // Claude Code plugin.json 메타 필드
    name: ExtensionNameSchema,
    version: SemVerSchema,
    displayName: Type.Optional(Type.String({ maxLength: 64 })),
    description: Type.Optional(Type.String({ maxLength: 1024 })),
    author: Type.Optional(ManifestAuthorSchema),
    homepage: Type.Optional(Type.String({ maxLength: 512 })),
    repository: Type.Optional(Type.String({ maxLength: 512 })),
    license: Type.Optional(Type.String({ maxLength: 128 })),
    keywords: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 16 })),
    defaultEnabled: Type.Optional(Type.Boolean()),
    components: Type.Optional(ManifestComponentsSchema),
    userConfig: Type.Optional(
      Type.Record(Type.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_]{0,63}$" }), UserConfigEntrySchema),
    ),
    // Xeon 필드
    layer: ExtensionLayerSchema,
    kind: ExtensionKindSchema,
    /** 확장 루트 기준 상대 경로. 예: "./src/index.ts" */
    entry: Type.String({ minLength: 1, maxLength: 512 }),
    requires: Type.Optional(Type.Array(CapabilityRequirementSchema, { maxItems: 128 })),
    optional: Type.Optional(Type.Array(CapabilityRequirementSchema, { maxItems: 128 })),
    provides: Type.Optional(Type.Array(CapabilityProvisionSchema, { maxItems: 128 })),
    /** on을 거는 지점 목록. 정적 선언. 빈 배열 허용 */
    points: Type.Array(PointNameSchema, { maxItems: 64 }),
    usesPost: Type.Optional(Type.Boolean()),
    usesDrive: Type.Boolean(),
    /** 이 확장이 쓰는 레코드 종류 */
    recordKinds: Type.Optional(Type.Array(RecordKindDeclJsonSchema, { maxItems: 128 })),
    /** 이 확장이 읽는 다른 그룹의 레코드 종류. 끝의 ".*"는 접두 일치 */
    readsRecordKinds: Type.Optional(
      Type.Array(Type.String({ pattern: RECORD_KIND_READ_PATTERN, maxLength: 160 }), {
        maxItems: 128,
      }),
    ),
    isolation: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("process")])),
    trust: Type.Optional(TrustRequestSchema),
  },
  { additionalProperties: false },
);
export type ExtensionManifest = Static<typeof ExtensionManifestSchema>;

/** 항등 함수. TS 모듈로 매니페스트를 쓰는 내장 패키지용. 검사는 validateManifest가 한다 */
export function defineManifest<const M extends ExtensionManifest>(manifest: M): M {
  return manifest;
}
