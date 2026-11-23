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
  type TRecord,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import {
  CapabilityIdSchema,
  COMMAND_NAME_PATTERN,
  SemVerRangeSchema,
  SemVerSchema,
  TOOL_NAME_PATTERN,
} from "../capabilities/index.ts";
import { RECORD_KIND_READ_PATTERN, RecordKindDeclJsonSchema } from "./group-record.ts";
import { ExtensionNameSchema } from "./name.ts";
import { DecisionKindSchema, HookNameSchema } from "./hooks.ts";
import { PluginIdSchema, RegistrationIdSchema } from "./registration-id.ts";
import { CompositionDeclSchema, type CompositionDecl } from "./composition.ts";
import { ExtMethodDeclSchema, type ExtMethodDecl } from "./ext-method.ts";
import { UiDeclSchema, type UiDecl } from "./ui.ts";
import { SCRIPT_LIMITS } from "./plugin-script.ts";

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

/** 매니페스트 형식 버전. 2는 `plugins[]`와 선택적 `orchestration`을 쓰는 형식이다. 옛 형식(1)은 읽지 않는다 */
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

/** Claude Code 구성요소 경로. 해석은 X. `instructions`는 항상 싣는 지침 파일 경로(M5c-1 추가) */
export const ManifestComponentsSchema: TObject<{
  skills: TOptional<typeof StringListSchema>;
  commands: TOptional<typeof StringListSchema>;
  agents: TOptional<typeof StringListSchema>;
  mcpServers: TOptional<TString>;
  instructions: TOptional<typeof StringListSchema>;
}> = Type.Object(
  {
    skills: Type.Optional(StringListSchema),
    commands: Type.Optional(StringListSchema),
    agents: Type.Optional(StringListSchema),
    mcpServers: Type.Optional(Type.String({ maxLength: 512 })),
    instructions: Type.Optional(StringListSchema),
  },
  { additionalProperties: false },
);

/**
 * 도구 선언 하나(`tools`, M5c-1). 코드가 등록할 도구를 정적으로 알린다. 카드와 비용의 근거다.
 * 이름이 같은 선언이 둘이면 `tool_duplicate`다(validateManifest)
 */
export const ManifestToolDeclSchema: TObject<{
  name: TString;
  description: TString;
}> = Type.Object(
  {
    name: Type.String({ pattern: TOOL_NAME_PATTERN, maxLength: 64 }),
    description: Type.String({ maxLength: 512 }),
  },
  { additionalProperties: false },
);
export type ManifestToolDecl = Static<typeof ManifestToolDeclSchema>;

/** 명령 선언 하나(`commands`, M5c-1). 이름이 같은 선언이 둘이면 `command_duplicate`다(validateManifest) */
export const ManifestCommandDeclSchema: TObject<{
  name: TString;
  description: TString;
}> = Type.Object(
  {
    name: Type.String({ pattern: COMMAND_NAME_PATTERN, maxLength: 96 }),
    description: Type.String({ maxLength: 512 }),
  },
  { additionalProperties: false },
);
export type ManifestCommandDecl = Static<typeof ManifestCommandDeclSchema>;

/** 스크립트 이름 형식(설계 B [제안]). `g.runScript(name)`의 이름과 같은 문법이다 */
export const SCRIPT_NAME_PATTERN: string = "^[a-z][a-z0-9-]{0,31}$";
/** 환경 변수 이름 형식(설계 B [제안]). 값은 플랫폼의 허용 목록 환경에서만 온다 */
export const SCRIPT_ENV_NAME_PATTERN: string = "^[A-Za-z_][A-Za-z0-9_]{0,127}$";

/** 실행기 고정 목록(설계 B [제안]). 엔진이 PATH에서 절대 경로로 풀어 띄운다. 목록 밖은 스키마 오류다 */
export const ScriptRunnerSchema: TUnion<
  [TLiteral<"sh">, TLiteral<"bash">, TLiteral<"bun">, TLiteral<"node">, TLiteral<"python3">]
> = Type.Union([
  Type.Literal("sh"),
  Type.Literal("bash"),
  Type.Literal("bun"),
  Type.Literal("node"),
  Type.Literal("python3"),
]);
export type ScriptRunner = Static<typeof ScriptRunnerSchema>;

/** 환경 모드 스크립트의 셸. 원래 하네스가 `bash`를 지정했으면 `bash`, 아니면 `sh`다 [결정: 2026-11-20, 사용자, AGE-58] */
export const ScriptEnvShellSchema: TUnion<[TLiteral<"sh">, TLiteral<"bash">]> = Type.Union([
  Type.Literal("sh"),
  Type.Literal("bash"),
]);

/** 환경 모드가 참조하는 파일의 지문 형식(`sha256:<64 hex>`). 가져올 때 적고 실행 직전에 다시 본다 */
export const SCRIPT_ENV_HASH_PATTERN: string = "^sha256:[0-9a-f]{64}$";

/**
 * 환경 모드 선언(`scripts[].env`, AGE-58 원칙 가, [제안] 이름 `env`). 가져온 훅이 "원래 돌던 환경"에서 도는 모양이다:
 * 원래 명령 문자열을 `shell -c`로, 프로젝트 폴더를 작업 폴더로, 사용자의 환경으로 돈다. 기존 선언(`file` + `runner`)은 그대로 "좁은 모드"다.
 * 이 필드는 선언일 뿐 권한이 아니다: 엔진은 마이그레이션 출처로 승인된 검토본에서만 이 선언을 받아들인다(`ScriptEnvGrant`). 그 밖은 `script_env_not_granted`다.
 * `file`은 명령 원문을 담은 동반 파일(`scripts/<이름>.cmd`)을 가리키고(내용 해시에 든다), `runner`는 `shell`과 같다.
 */
export const ScriptEnvDeclSchema: TObject<{
  command: TString;
  shell: typeof ScriptEnvShellSchema;
  refs: TArray<TObject<{ path: TString; hash: TUnion<[TString, TNull]> }>>;
  refsKnown: TBoolean;
}> = Type.Object(
  {
    /** 원래 명령 문자열 원문 */
    command: Type.String({ minLength: 1, maxLength: 4096 }),
    shell: ScriptEnvShellSchema,
    /** 명령이 참조한 파일(절대 경로)과 가져올 때의 지문. 지문이 null이면 가져올 때 읽지 못했다(실행 때 파일이 있어도 `unreadable`, 없으면 `missing`으로 닫힌 실패다) */
    refs: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 1024 }),
          hash: Type.Union([Type.String({ pattern: SCRIPT_ENV_HASH_PATTERN }), Type.Null()]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 16 },
    ),
    /** 참조 파일을 찾아냈는가. 거짓이면 어떤 파일을 읽는지 알 수 없다(리뷰 카드가 그렇게 말한다) */
    refsKnown: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ScriptEnvDecl = Static<typeof ScriptEnvDeclSchema>;

/**
 * 스크립트 선언 하나(`scripts`, 설계 B [제안]). `file`은 확장 루트 기준 상대 경로이고 위치 검사는 `validateManifest`가 한다
 * (`script_path_invalid`). 엔진은 `<runner 절대 경로> <플러그인 폴더>/<file> ...args`로 띄운다. 부르는 것은 코드의 `g.runScript(name)`이다
 */
export const ManifestScriptDeclSchema: TObject<{
  name: TString;
  runner: typeof ScriptRunnerSchema;
  file: TString;
  args: TOptional<TArray<TString>>;
  timeoutMs: TOptional<TInteger>;
  envNames: TOptional<TArray<TString>>;
  env: TOptional<typeof ScriptEnvDeclSchema>;
}> = Type.Object(
  {
    name: Type.String({ pattern: SCRIPT_NAME_PATTERN, maxLength: 32 }),
    runner: ScriptRunnerSchema,
    file: Type.String({ maxLength: 512 }),
    /** 실행기 뒤에 붙는 인자. 상한 16개, 각 512자 */
    args: Type.Optional(Type.Array(Type.String({ maxLength: 512 }), { maxItems: 16 })),
    /** 기한(ms). 생략하면 `SCRIPT_LIMITS.timeoutDefaultMs`, 상한은 `SCRIPT_LIMITS.timeoutMaxMs` */
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: SCRIPT_LIMITS.timeoutMaxMs })),
    /** 값을 넘겨 받을 환경 변수 이름. 개수 상한 16. 시크릿 거부 패턴에 걸리는 이름은 실행기가 뺀다 */
    envNames: Type.Optional(
      Type.Array(Type.String({ pattern: SCRIPT_ENV_NAME_PATTERN, maxLength: 128 }), {
        maxItems: 16,
      }),
    ),
    /** 환경 모드(가져온 훅). 없으면 좁은 모드다 */
    env: Type.Optional(ScriptEnvDeclSchema),
  },
  { additionalProperties: false },
);
export type ManifestScriptDecl = Static<typeof ManifestScriptDeclSchema>;

/**
 * 플러그인이 다른 플러그인에 거는 의존 한 줄(AGE-33, F.extensions.spec 의존 관계). `plugin`은 확장 이름이나 구성원
 * Registration id(`<이름>/<id>`)다. `kind`가 없으면 `soft`, `range`가 없으면 어느 버전이든 된다.
 * 기능 단위 `requires`·`optional`과 다른 선언이고 둘을 함께 써도 된다
 */
export const DependencyKindSchema: TUnion<[TLiteral<"hard">, TLiteral<"soft">]> = Type.Union([
  Type.Literal("hard"),
  Type.Literal("soft"),
]);
export type DependencyKind = Static<typeof DependencyKindSchema>;

export const DependencyDeclSchema: TObject<{
  plugin: typeof RegistrationIdSchema;
  range: TOptional<typeof SemVerRangeSchema>;
  kind: TOptional<typeof DependencyKindSchema>;
}> = Type.Object(
  {
    plugin: RegistrationIdSchema,
    range: Type.Optional(SemVerRangeSchema),
    kind: Type.Optional(DependencyKindSchema),
  },
  { additionalProperties: false },
);
export type DependencyDecl = Static<typeof DependencyDeclSchema>;

/** 확장이 담는 플러그인 하나. 이 선언 하나가 Registration 하나가 된다 */
export const PluginDeclSchema: TObject<{
  id: TOptional<typeof PluginIdSchema>;
  layer: typeof ExtensionLayerSchema;
  title: TOptional<TString>;
  defaultEnabled: TOptional<TBoolean>;
  hooks: TArray<typeof HookNameSchema>;
  hookDecides: TOptional<
    TArray<TObject<{ hook: typeof HookNameSchema; decides: TArray<typeof DecisionKindSchema> }>>
  >;
  usesPost: TOptional<TBoolean>;
  drives: TOptional<TBoolean>;
  requires: TOptional<TArray<typeof CapabilityRequirementSchema>>;
  optional: TOptional<TArray<typeof CapabilityRequirementSchema>>;
  provides: TOptional<TArray<typeof CapabilityProvisionSchema>>;
  dependsOn: TOptional<TArray<typeof DependencyDeclSchema>>;
  recordKinds: TOptional<TArray<typeof RecordKindDeclJsonSchema>>;
  readsRecordKinds: TOptional<TArray<TString>>;
  replaces: TOptional<TArray<TString>>;
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
    /**
     * 이 플러그인의 훅이 낼 수 있는 결정 종류를 미리 적는 선언(M5e 스펙 §4.1.1). `hooks`는 이름 문자열 목록이라
     * 결정 선언은 훅 이름과 짝을 이룬 별도 목록이다. 선언이 없는 훅은 정적으로 알 수 없다고 표시한다. 강제하지 않는다.
     */
    hookDecides: Type.Optional(
      Type.Array(
        Type.Object(
          {
            hook: HookNameSchema,
            decides: Type.Array(DecisionKindSchema, { minItems: 1, maxItems: 3 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 64 },
      ),
    ),
    usesPost: Type.Optional(Type.Boolean()),
    /** 이 플러그인이 drive를 등록한다. 허용 여부는 정책 `x.primitives.driveRequiresOrchestration`이 정한다 */
    drives: Type.Optional(Type.Boolean()),
    requires: Type.Optional(Type.Array(CapabilityRequirementSchema, { maxItems: 128 })),
    optional: Type.Optional(Type.Array(CapabilityRequirementSchema, { maxItems: 128 })),
    provides: Type.Optional(Type.Array(CapabilityProvisionSchema, { maxItems: 128 })),
    /** 다른 플러그인(이름이나 `이름/id`)에 거는 의존. `kind` 기본은 soft다 */
    dependsOn: Type.Optional(Type.Array(DependencyDeclSchema, { maxItems: 32 })),
    /** 이 플러그인이 쓰는 레코드 종류 */
    recordKinds: Type.Optional(Type.Array(RecordKindDeclJsonSchema, { maxItems: 128 })),
    /** 이 플러그인이 읽는 다른 확장의 레코드 종류. 끝의 ".*"는 접두 일치 */
    readsRecordKinds: Type.Optional(
      Type.Array(Type.String({ pattern: RECORD_KIND_READ_PATTERN, maxLength: 160 }), {
        maxItems: 128,
      }),
    ),
    /**
     * 같은 이름으로 바꿔 놓는 내장 도구 이름(F.capabilities.spec §10 [결정: 2026-11-03 사용자]).
     * 이 선언이 있는 이름만 내장 도구를 대체할 수 있고, 선언 없이 이름이 겹치면 대체가 아니다. 활성화는 사용자 승인이 있어야 한다
     */
    replaces: Type.Optional(
      Type.Array(Type.String({ pattern: TOOL_NAME_PATTERN, maxLength: 64 }), {
        maxItems: 16,
      }),
    ),
  },
  { additionalProperties: false },
);
export type PluginDecl = Static<typeof PluginDeclSchema>;

/** 오케스트레이션 선언. 있으면 그 확장은 구성원이 있는 플러그인이다 */
export const OrchestrationDeclSchema: TObject<{
  members: TOptional<TArray<typeof PluginIdSchema>>;
  composition: TOptional<TUnsafe<CompositionDecl>>;
}> = Type.Object(
  {
    /**
     * 한 번에 켜고 끄는 플러그인 id. 생략하면 모든 플러그인이 구성원이다.
     * 루트 플러그인(id 없음)은 적지 않으며 `members`가 있어도 항상 구성원이다
     */
    members: Type.Optional(Type.Array(PluginIdSchema, { minItems: 1, maxItems: 16 })),
    /** 구성 선언(X-16). 작성자가 선언하고 없으면 구성기는 블록 하나로 보인다. 오케스트레이션 선언이 있는 플러그인만 둘 수 있다 */
    composition: Type.Optional(CompositionDeclSchema),
  },
  { additionalProperties: false },
);
export type OrchestrationDecl = Static<typeof OrchestrationDeclSchema>;

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
  purpose: TOptional<TString>;
  tools: TOptional<TArray<typeof ManifestToolDeclSchema>>;
  commands: TOptional<TArray<typeof ManifestCommandDeclSchema>>;
  scripts: TOptional<TArray<typeof ManifestScriptDeclSchema>>;
  entry: TOptional<TString>;
  plugins: TOptional<TArray<typeof PluginDeclSchema>>;
  orchestration: TOptional<typeof OrchestrationDeclSchema>;
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
    /** 한 문장짜리 목적(M5c-1). 카드의 `purpose`가 된다. 없으면 검토에서 승인할 수 없다 */
    purpose: Type.Optional(Type.String({ maxLength: 200 })),
    /** 코드가 등록할 도구의 정적 선언(M5c-1). 이름은 검사에서 중복을 막는다 */
    tools: Type.Optional(Type.Array(ManifestToolDeclSchema, { maxItems: 64 })),
    /** 명령의 정적 선언(M5c-1). 이름은 검사에서 중복을 막는다 */
    commands: Type.Optional(Type.Array(ManifestCommandDeclSchema, { maxItems: 64 })),
    /**
     * 스크립트의 정적 선언(설계 B [제안]). 엔진이 플러그인 폴더 안의 파일을 실행기로 띄운다. 이름은 검사에서 중복을 막는다.
     * `entry`가 없으면 부를 코드가 없으므로 실행되지 않는다(오류가 아니다)
     */
    scripts: Type.Optional(Type.Array(ManifestScriptDeclSchema, { maxItems: 64 })),
    /**
     * 확장 루트 기준 상대 경로. 예: "./src/index.ts". 엔트리 모듈 하나가 모든 플러그인을 등록한다.
     * 생략할 수 있다(M5c-1). 생략하면 코드 플러그인이 아니고 폴더 신호에서 추론한다(§4.5.4)
     */
    entry: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    /** 확장이 담는 플러그인. 생략할 수 있다(M5c-1). 생략하면 루트 플러그인 하나를 추론한다(§4.5.4) */
    plugins: Type.Optional(Type.Array(PluginDeclSchema, { minItems: 1, maxItems: 16 })),
    orchestration: Type.Optional(OrchestrationDeclSchema),
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

/** 사람이 읽는 두 칸: 목적 한 문장(`purpose`)과 설명(`description`) */
export type ManifestTextField = "purpose" | "description";

/**
 * 매니페스트에서 비어 있는 사람용 칸(앞뒤 공백만 있으면 빈 것으로 본다). 스키마는 두 칸을 선택으로 두고(옛 매니페스트와 시험 픽스처를 깨지 않는다),
 * 필수는 이 함수를 쓰는 곳이 강제한다: 제작 검사 AU-013(오류), 검토 승인(`pluginReview.purposeRequired`, `pluginReview.descriptionRequired`),
 * 내장 플러그인 시험. 설치된 플러그인은 비어 있어도 불러온다(화면이 "설명이 없어요"를 보인다) [결정: 2026-11-23 사용자, AGE-31]
 */
export function manifestTextGaps(
  manifest: Pick<ExtensionManifest, "purpose" | "description">,
): readonly ManifestTextField[] {
  const gaps: ManifestTextField[] = [];
  if ((manifest.purpose ?? "").trim() === "") gaps.push("purpose");
  if ((manifest.description ?? "").trim() === "") gaps.push("description");
  return gaps;
}

/** 항등 함수. TS 모듈로 매니페스트를 쓰는 내장 패키지용. 검사는 validateManifest가 한다 */
export function defineManifest<const M extends ExtensionManifest>(manifest: M): M {
  return manifest;
}

/** `orchestration` 선언이 있으면 구성원이 있는 플러그인이다. 기록·상태 접두를 이 함수 하나로 고른다 */
export function isOrchestrationExtension(
  manifest: Pick<ExtensionManifest, "orchestration">,
): boolean {
  return manifest.orchestration !== undefined;
}

/** 확장 접두: `orchestration` 선언이 있으면 "grp", 아니면 "x" */
export function extensionPrefix(manifest: Pick<ExtensionManifest, "orchestration">): "grp" | "x" {
  return isOrchestrationExtension(manifest) ? "grp" : "x";
}

/** 루트 플러그인(id 없음)은 확장 이름, 그 밖은 "<확장 이름>/<플러그인 id>" */
export function registrationIdOf(
  manifest: Pick<ExtensionManifest, "name">,
  pluginId: string | undefined,
): string {
  return pluginId === undefined ? manifest.name : `${manifest.name}/${pluginId}`;
}

/**
 * `plugins`가 없을 때 §4.5.4가 채우는 루트 플러그인 하나(층 `plugin`, 훅 없음). 추론한 매니페스트는 파일에 쓰지 않는다.
 * 검사와 목록이 같은 모양을 보도록 여기 둔다
 */
const INFERRED_PLUGIN_DECLS: readonly PluginDecl[] = [{ layer: "plugin", hooks: [] }];

/** 플러그인 선언 목록. `plugins`가 있으면 그대로, 없으면 추론한 루트 플러그인 하나 */
export function pluginDeclsOf(manifest: {
  readonly plugins?: readonly PluginDecl[];
}): readonly PluginDecl[] {
  return manifest.plugins ?? INFERRED_PLUGIN_DECLS;
}

export interface PluginEntry {
  /** `plugins` 안의 위치. 검증 경로(`/plugins/<index>`)에 쓴다 */
  readonly index: number;
  readonly registrationId: string;
  readonly decl: PluginDecl;
  /** id가 없는 루트 플러그인인가 */
  readonly root: boolean;
  /** 구성원이 있는 플러그인의 구성원인가. `orchestration.members`가 없으면 모든 플러그인, 있으면 루트와 목록의 플러그인 */
  readonly inOrchestration: boolean;
}

export function pluginsOf(
  manifest: Pick<ExtensionManifest, "name" | "plugins" | "orchestration">,
): readonly PluginEntry[] {
  const members = manifest.orchestration?.members;
  return pluginDeclsOf(manifest).map((decl, index) => ({
    index,
    registrationId: registrationIdOf(manifest, decl.id),
    decl,
    root: decl.id === undefined,
    inOrchestration:
      manifest.orchestration !== undefined &&
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
  for (const { layer } of pluginDeclsOf(manifest)) {
    if (LAYER_RANK[layer] > LAYER_RANK[best]) best = layer;
  }
  return best;
}
