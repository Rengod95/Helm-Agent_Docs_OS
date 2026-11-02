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
  type TUnsafe,
} from "typebox";
import { CapabilityIdSchema, SemVerRangeSchema, SemVerSchema } from "../capabilities/index.ts";
import { RECORD_KIND_READ_PATTERN, RecordKindDeclJsonSchema } from "./group-record.ts";
import { ExtensionNameSchema } from "./name.ts";
import { HookNameSchema } from "./hooks.ts";
import { PluginIdSchema } from "./registration-id.ts";
import { ExtMethodDeclSchema, type ExtMethodDecl } from "./ext-method.ts";
import { UiDeclSchema, type UiDecl } from "./ui.ts";

export { EXTENSION_NAME_PATTERN, ExtensionNameSchema, type ExtensionName } from "./name.ts";

export const ExtensionLayerSchema: TUnion<
  [TLiteral<"L1">, TLiteral<"L2">, TLiteral<"L3">, TLiteral<"plugin">]
> = Type.Union([
  Type.Literal("L1"),
  Type.Literal("L2"),
  Type.Literal("L3"),
  Type.Literal("plugin"),
]);

export type ExtensionLayer = Static<typeof ExtensionLayerSchema>;

/** 매니페스트 형식 버전. 2는 `plugins[]`와 선택적 `group`을 쓰는 형식이다. 옛 형식(1)은 읽지 않는다 */
export const MANIFEST_SCHEMA_VERSION = 2 as const;

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
    /** 참이면 값은 시크릿 참조(secret://)로만 저장한다(L0.secrets.spec) */
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

/** 확장이 담는 플러그인 하나. 이 선언 하나가 Registration 하나가 된다 */
export const PluginDeclSchema: TObject<{
  id: TOptional<typeof PluginIdSchema>;
  layer: typeof ExtensionLayerSchema;
  title: TOptional<TString>;
  defaultEnabled: TOptional<TBoolean>;
  hooks: TArray<typeof HookNameSchema>;
  usesPost: TOptional<TBoolean>;
  drives: TOptional<TBoolean>;
  requires: TOptional<TArray<typeof CapabilityRequirementSchema>>;
  optional: TOptional<TArray<typeof CapabilityRequirementSchema>>;
  provides: TOptional<TArray<typeof CapabilityProvisionSchema>>;
  recordKinds: TOptional<TArray<typeof RecordKindDeclJsonSchema>>;
  readsRecordKinds: TOptional<TArray<TString>>;
}> = Type.Object(
  {
    /** 생략하면 확장의 루트 플러그인. 확장당 하나만 생략할 수 있다 */
    id: Type.Optional(PluginIdSchema),
    layer: ExtensionLayerSchema,
    title: Type.Optional(Type.String({ maxLength: 64 })),
    /** Registration 기본 켜짐. 생략하면 루트는 확장 defaultEnabled ?? true, 루트가 아니면 false */
    defaultEnabled: Type.Optional(Type.Boolean()),
    /** 이 플러그인이 on을 거는 Hook 목록. 정적 선언. 빈 배열 허용 */
    hooks: Type.Array(HookNameSchema, { maxItems: 64 }),
    usesPost: Type.Optional(Type.Boolean()),
    /** 이 플러그인이 drive를 등록한다. 허용 여부는 정책 `x.primitives.driveRequiresGroup`이 정한다 */
    drives: Type.Optional(Type.Boolean()),
    requires: Type.Optional(Type.Array(CapabilityRequirementSchema, { maxItems: 128 })),
    optional: Type.Optional(Type.Array(CapabilityRequirementSchema, { maxItems: 128 })),
    provides: Type.Optional(Type.Array(CapabilityProvisionSchema, { maxItems: 128 })),
    /** 이 플러그인이 쓰는 레코드 종류 */
    recordKinds: Type.Optional(Type.Array(RecordKindDeclJsonSchema, { maxItems: 128 })),
    /** 이 플러그인이 읽는 다른 확장의 레코드 종류. 끝의 ".*"는 접두 일치 */
    readsRecordKinds: Type.Optional(
      Type.Array(Type.String({ pattern: RECORD_KIND_READ_PATTERN, maxLength: 160 }), {
        maxItems: 128,
      }),
    ),
  },
  { additionalProperties: false },
);
export type PluginDecl = Static<typeof PluginDeclSchema>;

/** 플러그인 그룹 선언. 있으면 그 확장은 플러그인 그룹이다 */
export const GroupDeclSchema: TObject<{
  members: TOptional<TArray<typeof PluginIdSchema>>;
}> = Type.Object(
  {
    /**
     * 한 번에 켜고 끄는 플러그인 id. 생략하면 모든 플러그인이 구성원이다.
     * 루트 플러그인(id 없음)은 적지 않으며 `members`가 있어도 항상 구성원이다
     */
    members: Type.Optional(Type.Array(PluginIdSchema, { minItems: 1, maxItems: 16 })),
  },
  { additionalProperties: false },
);
export type GroupDecl = Static<typeof GroupDeclSchema>;

/** Claude Code plugin.json의 레이아웃과 메타 필드를 따르고 Fresnel 필드를 더한다 */
export const ExtensionManifestSchema: TObject<{
  schemaVersion: TLiteral<2>;
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
  entry: TString;
  plugins: TArray<typeof PluginDeclSchema>;
  group: TOptional<typeof GroupDeclSchema>;
  ui: TOptional<TUnsafe<UiDecl>>;
  methods: TOptional<TArray<TUnsafe<ExtMethodDecl>>>;
  isolation: TOptional<TUnion<[TLiteral<"none">, TLiteral<"process">]>>;
  trust: TOptional<typeof TrustRequestSchema>;
}> = Type.Object(
  {
    schemaVersion: Type.Literal(MANIFEST_SCHEMA_VERSION),
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
    // Fresnel 필드: 확장 수준
    /** 확장 루트 기준 상대 경로. 예: "./src/index.ts". 엔트리 모듈 하나가 모든 플러그인을 등록한다 */
    entry: Type.String({ minLength: 1, maxLength: 512 }),
    plugins: Type.Array(PluginDeclSchema, { minItems: 1, maxItems: 16 }),
    group: Type.Optional(GroupDeclSchema),
    /** Plugin UI 기여(ADR-0021). 확장 수준이고 화면마다 mode가 native 또는 app이다 */
    ui: Type.Optional(UiDeclSchema),
    /** 확장 메서드 `ext.<확장 이름>.<verb>`. Plugin UI와 따로 선언할 수 있다 */
    methods: Type.Optional(Type.Array(ExtMethodDeclSchema, { maxItems: 64 })),
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

/** `group` 선언이 있으면 플러그인 그룹이다. 기록·상태 접두를 이 함수 하나로 고른다 */
export function isGroupExtension(manifest: Pick<ExtensionManifest, "group">): boolean {
  return manifest.group !== undefined;
}

/** 확장 접두: 플러그인 그룹이면 "grp", 아니면 "x" */
export function extensionPrefix(manifest: Pick<ExtensionManifest, "group">): "grp" | "x" {
  return isGroupExtension(manifest) ? "grp" : "x";
}

/** 루트 플러그인(id 없음)은 확장 이름, 그 밖은 "<확장 이름>/<플러그인 id>" */
export function registrationIdOf(
  manifest: Pick<ExtensionManifest, "name">,
  pluginId: string | undefined,
): string {
  return pluginId === undefined ? manifest.name : `${manifest.name}/${pluginId}`;
}

export interface PluginEntry {
  /** `plugins` 안의 위치. 검증 경로(`/plugins/<index>`)에 쓴다 */
  readonly index: number;
  readonly registrationId: string;
  readonly decl: PluginDecl;
  /** id가 없는 루트 플러그인인가 */
  readonly root: boolean;
  /** 플러그인 그룹의 구성원인가. `group.members`가 없으면 모든 플러그인, 있으면 루트와 목록의 플러그인 */
  readonly inGroup: boolean;
}

export function pluginsOf(
  manifest: Pick<ExtensionManifest, "name" | "plugins" | "group">,
): readonly PluginEntry[] {
  const members = manifest.group?.members;
  return manifest.plugins.map((decl, index) => ({
    index,
    registrationId: registrationIdOf(manifest, decl.id),
    decl,
    root: decl.id === undefined,
    inGroup:
      manifest.group !== undefined &&
      (members === undefined || decl.id === undefined || members.includes(decl.id)),
  }));
}

/** Registration 기본 켜짐: 플러그인 `defaultEnabled`, 없으면 루트는 확장 `defaultEnabled ?? true`, 루트가 아니면 false */
export function pluginDefaultEnabled(
  manifest: Pick<ExtensionManifest, "defaultEnabled">,
  entry: Pick<PluginEntry, "decl" | "root">,
): boolean {
  return entry.decl.defaultEnabled ?? (entry.root ? (manifest.defaultEnabled ?? true) : false);
}

const LAYER_RANK: Readonly<Record<ExtensionLayer, number>> = { plugin: 0, L1: 1, L2: 2, L3: 3 };

/**
 * 확장의 유효 층(로드 순서, tier, 안전 모드 판정): 플러그인 층 가운데 가장 높은 층.
 * 외부 `plugin`은 `L1`~`L3`와 섞을 수 없다(`layer_mixed_external`)
 */
export function effectiveLayer(manifest: Pick<ExtensionManifest, "plugins">): ExtensionLayer {
  let best: ExtensionLayer = "plugin";
  for (const { layer } of manifest.plugins) {
    if (LAYER_RANK[layer] > LAYER_RANK[best]) best = layer;
  }
  return best;
}
