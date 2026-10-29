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
  CheckpointIdSchema,
  JsonValueSchema,
  ThreadIdSchema,
  TurnIdSchema,
  localIdPattern,
  type JsonValue,
} from "../../conversation/index.ts";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolContent, ToolSpec } from "../tool-spec.ts";

// L2.artifacts.spec §3.1~§3.4. 정의 파일은 이 파일 하나다.
// §3.4(sessions)는 setMeta·list·search와 session_rename만 정의한다. handoff·export는 2차다.
// records/는 import하지 않는다(F.readme §3 같은 순서). HunkDecision·코멘트 대상·BlobRef 모양은
// records/catalog/approval.ts, records/blob.ts와 같게 적고, 같은지는 test/capabilities/artifacts-defs.test.ts가 확인한다.

// ── 공통 스키마 (§3.1) ─────────────────────────────────────────────────

/** 지역 ID. 접두 art·rvw·cmt는 F.conversation.spec §3.2.1 LocalIdPrefix 표다 */
export const ArtifactIdSchema: TString = Type.String({ pattern: localIdPattern("art") });
export const ReviewIdSchema: TString = Type.String({ pattern: localIdPattern("rvw") });
export const CommentIdSchema: TString = Type.String({ pattern: localIdPattern("cmt") });

/** 리뷰 안에서만 유일하다. f<파일 순번>h<hunk 순번>. 정규화한 diff에서 결정적으로 만든다(§4.2.2) */
export const HunkIdSchema: TString = Type.String({ pattern: "^f[0-9]{1,4}h[0-9]{1,4}$" });

/** 도구 호출 ID. 형식은 F.conversation.spec이 정하고 여기서는 길이만 제한한다 */
export const ToolCallIdSchema: TString = Type.String({ minLength: 1, maxLength: 128 });

/** F.extensions.spec PostWhen과 같은 값 집합 */
export const PostWhenSchema: TUnion<[TLiteral<"steer">, TLiteral<"followUp">, TLiteral<"next">]> =
  Type.Union([Type.Literal("steer"), Type.Literal("followUp"), Type.Literal("next")]);

// ── 공통 스키마 나머지 (§3.1) ──────────────────────────────────────────

/**
 * 산출물 종류. 내장 7종과 확장 종류. 확장 종류 형식은 §3.1 주석과 spec §10 미결을 본다.
 * 확장 패턴은 F.records.spec 확장 kind의 앞 세 마디(x.<이름>.<영역>)를 따른다.
 */
export const ArtifactKindSchema: TUnion<
  [
    TLiteral<"document">,
    TLiteral<"table">,
    TLiteral<"plan">,
    TLiteral<"changeset">,
    TLiteral<"file">,
    TLiteral<"image">,
    TLiteral<"log">,
    TString,
  ]
> = Type.Union([
  Type.Literal("document"), // 글. text/markdown, text/plain 등
  Type.Literal("table"), // 표. text/csv, application/json(행 배열)
  Type.Literal("plan"), // 계획. work.plans가 등록한다
  Type.Literal("changeset"), // 파일 변경 목록. 리뷰가 등록한다. 본문은 통합 diff
  Type.Literal("file"), // 작업 공간 파일의 등록 시점 사본
  Type.Literal("image"), // 이미지
  Type.Literal("log"), // 명령 출력, 실행 기록
  Type.String({ pattern: "^(x|grp)\\.[a-z][a-z0-9-]{1,31}\\.[a-z][a-z0-9_]{0,31}$" }), // 확장 종류
]);
export type ArtifactKind = Static<typeof ArtifactKindSchema>;

export const MediaTypeSchema: TString = Type.String({
  pattern: "^[a-z]+/[a-z0-9.+-]+$",
  maxLength: 128,
});

/**
 * F.records.spec §3.4 BlobRef와 같은 모양. defs는 records를 import하지 않으므로 여기 적는다
 * (workspace.ts의 ImageBlobRefSchema와 같은 방식). 두 모양이 같은지는 artifacts-defs.test.ts가 확인한다.
 */
export const ArtifactBlobRefSchema: TObject<{
  type: TLiteral<"blob">;
  sha256: TString;
  size: TInteger;
  mediaType: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    type: Type.Literal("blob"),
    /** 소문자 hex 64자 */
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$", minLength: 64, maxLength: 64 }),
    size: Type.Integer({ minimum: 0 }),
    mediaType: Type.Union([Type.String({ minLength: 1, maxLength: 127 }), Type.Null()]),
  },
  { additionalProperties: false },
);

/** 등록·갱신 입력의 본문. 저장할 때는 항상 blob 하나가 된다(§4.1.2) */
export const ArtifactContentInputSchema: TUnion<
  [
    TObject<{ type: TLiteral<"inline">; text: TString; mediaType: TString }>,
    TObject<{ type: TLiteral<"blob">; ref: typeof ArtifactBlobRefSchema }>,
    TObject<{ type: TLiteral<"file">; path: TString }>,
  ]
> = Type.Union([
  Type.Object({
    type: Type.Literal("inline"),
    text: Type.String({ maxLength: 1_048_576 }),
    mediaType: MediaTypeSchema,
  }),
  Type.Object({ type: Type.Literal("blob"), ref: ArtifactBlobRefSchema }),
  Type.Object({
    type: Type.Literal("file"),
    path: Type.String({ minLength: 1, maxLength: 4096 }),
  }),
]);

/** 웹 유래 출처의 캐시 정책. 값 집합은 L2.web.spec의 Source.usage.cache와 같다(§4.5.3) */
export const SourceCacheSchema: TUnion<
  [TLiteral<"none">, TLiteral<"session">, TLiteral<"persist">]
> = Type.Union([Type.Literal("none"), Type.Literal("session"), Type.Literal("persist")]);

export const ArtifactSourceSchema: TObject<{
  url: TString;
  title: TOptional<TString>;
  cache: typeof SourceCacheSchema;
  license: TOptional<TString>;
}> = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 2048 }),
  title: Type.Optional(Type.String({ maxLength: 300 })),
  cache: SourceCacheSchema,
  license: Type.Optional(Type.String({ maxLength: 200 })),
});

const ArtifactPreviewSchema: TObject<{
  lines: TOptional<TInteger>;
  rows: TOptional<TInteger>;
  columns: TOptional<TInteger>;
  pages: TOptional<TInteger>;
  files: TOptional<TInteger>;
  hunks: TOptional<TInteger>;
  language: TOptional<TString>;
  width: TOptional<TInteger>;
  height: TOptional<TInteger>;
}> = Type.Object({
  lines: Type.Optional(Type.Integer({ minimum: 0 })),
  rows: Type.Optional(Type.Integer({ minimum: 0 })),
  columns: Type.Optional(Type.Integer({ minimum: 0 })),
  pages: Type.Optional(Type.Integer({ minimum: 0 })),
  files: Type.Optional(Type.Integer({ minimum: 0 })), // changeset
  hunks: Type.Optional(Type.Integer({ minimum: 0 })), // changeset
  language: Type.Optional(Type.String({ maxLength: 32 })),
  width: Type.Optional(Type.Integer({ minimum: 0 })), // image
  height: Type.Optional(Type.Integer({ minimum: 0 })), // image
});

/** 미리보기 메타. L4가 본문을 열지 않고 카드를 그릴 때 쓴다. 직렬화 크기 16 KiB 이하(§4.1.4) */
export const ArtifactMetaSchema: TObject<{
  summary: TOptional<TString>;
  preview: TOptional<typeof ArtifactPreviewSchema>;
  tags: TOptional<TArray<TString>>;
  sources: TOptional<TArray<typeof ArtifactSourceSchema>>;
  /** 값은 JSON이다(JsonValueSchema). Type.Unknown이면 structuredContent의 JsonValue 타입과 맞지 않는다 */
  custom: TOptional<TRecord<"^.*$", TUnsafe<JsonValue>>>;
}> = Type.Object({
  summary: Type.Optional(Type.String({ maxLength: 500 })),
  preview: Type.Optional(ArtifactPreviewSchema),
  tags: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { maxItems: 16, uniqueItems: true }),
  ),
  sources: Type.Optional(Type.Array(ArtifactSourceSchema, { maxItems: 64 })),
  custom: Type.Optional(
    Type.Record(Type.String({ pattern: "^[a-z][a-zA-Z0-9]{0,31}$" }), JsonValueSchema),
  ),
});
export type ArtifactMeta = Static<typeof ArtifactMetaSchema>;

/** 생산자. "model"(도구 경로), "user"(L4 명령), "cap.<도메인>"(다른 L2), "x.<확장>" 또는 "grp.<그룹>" */
export const ArtifactProducerSchema: TString = Type.String({
  pattern: "^(model|user|cap\\.[a-z][a-z0-9-]{1,31}|(x|grp)\\.[a-z][a-z0-9-]{1,31})$",
});

export const ArtifactOriginSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  turnId: TUnion<[typeof TurnIdSchema, TNull]>;
  toolCallId: TUnion<[TString, TNull]>;
  producer: TString;
}> = Type.Object({
  threadId: ThreadIdSchema,
  turnId: Type.Union([TurnIdSchema, Type.Null()]),
  toolCallId: Type.Union([ToolCallIdSchema, Type.Null()]),
  producer: ArtifactProducerSchema,
});

export const ArtifactStatusSchema: TUnion<[TLiteral<"active">, TLiteral<"archived">]> = Type.Union([
  Type.Literal("active"),
  Type.Literal("archived"),
]);

export const ArtifactSummarySchema: TObject<{
  artifactId: TString;
  kind: typeof ArtifactKindSchema;
  title: TString;
  version: TInteger;
  status: typeof ArtifactStatusSchema;
  content: typeof ArtifactBlobRefSchema;
  sourcePath: TUnion<[TString, TNull]>;
  meta: typeof ArtifactMetaSchema;
  origin: typeof ArtifactOriginSchema;
  createdAt: TInteger;
  updatedAt: TInteger;
}> = Type.Object({
  artifactId: ArtifactIdSchema,
  kind: ArtifactKindSchema,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  version: Type.Integer({ minimum: 1 }),
  status: ArtifactStatusSchema,
  content: ArtifactBlobRefSchema,
  /** content.type이 "file"로 등록된 경우 그 경로. 작업 공간 기준 상대 경로 */
  sourcePath: Type.Union([Type.String(), Type.Null()]),
  meta: ArtifactMetaSchema,
  origin: ArtifactOriginSchema,
  /** 등록 이벤트와 마지막 갱신 이벤트의 recordedAt(ms) */
  createdAt: Type.Integer({ minimum: 0 }),
  updatedAt: Type.Integer({ minimum: 0 }),
});
export type ArtifactSummary = Static<typeof ArtifactSummarySchema>;

/**
 * 산출물 버전 참조. spec §3.1의 ArtifactRefSchema다. 이름은 work.ts의 ArtifactRefSchema(작업 항목용 참조)와
 * 겹쳐 바꾸었다([결정: M3b B2-ART]). 쓰는 곳은 2차 handoff 입력뿐이다.
 */
export const ArtifactVersionRefSchema: TObject<{
  artifactId: TString;
  version: TOptional<TInteger>;
}> = Type.Object({
  artifactId: ArtifactIdSchema,
  /** 생략하면 최신 */
  version: Type.Optional(Type.Integer({ minimum: 1 })),
});

// ── artifacts.registry (§3.2) ──────────────────────────────────────────

const RegisterInput: TObject<{
  threadId: TOptional<typeof ThreadIdSchema>;
  kind: typeof ArtifactKindSchema;
  title: TString;
  content: typeof ArtifactContentInputSchema;
  meta: TOptional<typeof ArtifactMetaSchema>;
  producer: TOptional<TString>;
}> = Type.Object({
  /** 생략하면 CallContext.threadId(§3.5) */
  threadId: Type.Optional(ThreadIdSchema),
  kind: ArtifactKindSchema,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  content: ArtifactContentInputSchema,
  meta: Type.Optional(ArtifactMetaSchema),
  /** 생략하면 CallContext로 정한다. 도구 경로는 "model" */
  producer: Type.Optional(ArtifactProducerSchema),
});

const UpdateInput: TObject<{
  artifactId: TString;
  baseVersion: TInteger;
  title: TOptional<TString>;
  content: TOptional<typeof ArtifactContentInputSchema>;
  meta: TOptional<typeof ArtifactMetaSchema>;
}> = Type.Object({
  artifactId: ArtifactIdSchema,
  /** 낙관적 동시성. 현재 최신 버전과 같아야 한다 */
  baseVersion: Type.Integer({ minimum: 1 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  content: Type.Optional(ArtifactContentInputSchema),
  /** 주면 메타 전체를 바꾼다. 부분 병합은 하지 않는다 */
  meta: Type.Optional(ArtifactMetaSchema),
});

const ListInput: TObject<{
  threadId: TOptional<typeof ThreadIdSchema>;
  kinds: TOptional<TArray<typeof ArtifactKindSchema>>;
  status: TOptional<TUnion<[typeof ArtifactStatusSchema, TLiteral<"all">]>>;
  turnId: TOptional<typeof TurnIdSchema>;
  cursor: TOptional<TString>;
  limit: TOptional<TInteger>;
}> = Type.Object({
  threadId: Type.Optional(ThreadIdSchema), // 생략하면 모든 세션
  kinds: Type.Optional(Type.Array(ArtifactKindSchema, { minItems: 1, maxItems: 16 })),
  status: Type.Optional(Type.Union([ArtifactStatusSchema, Type.Literal("all")])), // 기본 "active"
  turnId: Type.Optional(TurnIdSchema),
  cursor: Type.Optional(Type.String({ maxLength: 128 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

const ListOutput: TObject<{
  items: TArray<typeof ArtifactSummarySchema>;
  nextCursor: TUnion<[TString, TNull]>;
}> = Type.Object({
  items: Type.Array(ArtifactSummarySchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

const GetInput: TObject<{
  artifactId: TString;
  version: TOptional<TInteger>;
  includeText: TOptional<TBoolean>;
}> = Type.Object({
  artifactId: ArtifactIdSchema,
  version: Type.Optional(Type.Integer({ minimum: 1 })),
  /** 참이면 텍스트 mediaType이고 256 KiB 이하일 때 본문을 text로 싣는다 */
  includeText: Type.Optional(Type.Boolean()),
});

const GetOutput: TObject<{
  artifact: typeof ArtifactSummarySchema;
  latestVersion: TInteger;
  text: TUnion<[TString, TNull]>;
}> = Type.Object({
  artifact: ArtifactSummarySchema, // 요청한 버전 기준
  latestVersion: Type.Integer({ minimum: 1 }),
  text: Type.Union([Type.String(), Type.Null()]),
});

const ArchiveInput: TObject<{
  artifactId: TString;
  reason: TOptional<TUnion<[TLiteral<"user">, TLiteral<"retention">, TLiteral<"limit">]>>;
}> = Type.Object({
  artifactId: ArtifactIdSchema,
  reason: Type.Optional(
    Type.Union([Type.Literal("user"), Type.Literal("retention"), Type.Literal("limit")]),
  ),
});

/** artifact_create 도구의 파라미터. 모델에게는 텍스트로 만들 수 있는 4종만 보인다(§3.2) */
const ArtifactCreateParams: TObject<{
  kind: TUnion<[TLiteral<"document">, TLiteral<"table">, TLiteral<"plan">, TLiteral<"log">]>;
  title: TString;
  text: TString;
  mediaType: TOptional<TString>;
  summary: TOptional<TString>;
}> = Type.Object({
  kind: Type.Union([
    Type.Literal("document"),
    Type.Literal("table"),
    Type.Literal("plan"),
    Type.Literal("log"),
  ]),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  text: Type.String({ minLength: 1, maxLength: 1_048_576, description: "본문" }),
  mediaType: Type.Optional(MediaTypeSchema),
  summary: Type.Optional(Type.String({ maxLength: 500 })),
});

/** artifact_update 도구의 파라미터 */
const ArtifactUpdateParams: TObject<{
  artifactId: TString;
  baseVersion: TInteger;
  title: TOptional<TString>;
  text: TOptional<TString>;
  mediaType: TOptional<TString>;
  summary: TOptional<TString>;
}> = Type.Object({
  artifactId: ArtifactIdSchema,
  baseVersion: Type.Integer({ minimum: 1 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 1_048_576 })),
  mediaType: Type.Optional(MediaTypeSchema),
  summary: Type.Optional(Type.String({ maxLength: 500 })),
});

function renderArtifact(out: ArtifactSummary): ToolContent {
  return {
    content: [
      {
        type: "text",
        text: `artifact ${out.artifactId} v${out.version} kind=${out.kind} title=${JSON.stringify(out.title)}`,
      },
    ],
    structuredContent: out,
  };
}

type RegistryMethods = {
  readonly register: MethodDef<typeof RegisterInput, typeof ArtifactSummarySchema>;
  readonly update: MethodDef<typeof UpdateInput, typeof ArtifactSummarySchema>;
  readonly list: MethodDef<typeof ListInput, typeof ListOutput>;
  readonly get: MethodDef<typeof GetInput, typeof GetOutput>;
  readonly archive: MethodDef<typeof ArchiveInput, typeof ArtifactSummarySchema>;
};

/**
 * 세션 산출물 등록·갱신·조회. register·update·archive는 requestId로 멱등이고, list·get은 읽기 전용이다.
 * 입력에 requestId 필드를 두지 않는다(CallOptions.requestId로 막는다).
 */
export const ArtifactsRegistry: CapabilityDef<
  RegistryMethods,
  readonly [
    ToolSpec<"register", typeof ArtifactCreateParams, RegistryMethods["register"]>,
    ToolSpec<"update", typeof ArtifactUpdateParams, RegistryMethods["update"]>,
  ]
> = defineCapability({
  id: "artifacts.registry",
  version: "1.0.0",
  description: "세션 산출물 등록·갱신·조회. 본문은 blob이고 버전과 출처를 기록한다.",
  service: {
    methods: {
      register: {
        description: "산출물을 새로 등록한다. 버전 1을 만든다.",
        input: RegisterInput,
        output: ArtifactSummarySchema,
        replay: "safe",
        idempotent: true,
        errors: {
          artifact_limit_reached: {
            description: "세션당 산출물 상한(l2.artifacts.maxPerSession)을 넘음",
            retryable: false,
          },
          content_too_large: {
            description: "본문이 l2.artifacts.maxContentBytes를 넘음",
            retryable: false,
          },
          file_unreadable: {
            description: "content.type file의 경로를 읽을 수 없음",
            retryable: false,
          },
        },
      },
      update: {
        description: "산출물의 새 버전을 만든다. baseVersion이 최신과 같아야 한다.",
        input: UpdateInput,
        output: ArtifactSummarySchema,
        replay: "safe",
        idempotent: true,
        errors: {
          version_conflict: {
            description: "baseVersion이 최신 버전과 다름",
            retryable: false,
            detail: Type.Object({ latestVersion: Type.Integer({ minimum: 1 }) }),
          },
          artifact_archived: { description: "보관된 산출물은 갱신할 수 없음", retryable: false },
          content_too_large: {
            description: "본문이 l2.artifacts.maxContentBytes를 넘음",
            retryable: false,
          },
          file_unreadable: {
            description: "content.type file의 경로를 읽을 수 없음",
            retryable: false,
          },
        },
      },
      list: {
        description: "산출물 목록을 최근 갱신 순으로 돌려준다.",
        input: ListInput,
        output: ListOutput,
        replay: "safe",
        readOnly: true,
      },
      get: {
        description: "산출물 하나와 선택한 버전을 돌려준다.",
        input: GetInput,
        output: GetOutput,
        replay: "safe",
        readOnly: true,
      },
      archive: {
        description: "산출물을 보관 상태로 바꾼다. 이벤트와 blob은 지우지 않는다.",
        input: ArchiveInput,
        output: ArtifactSummarySchema,
        replay: "safe",
        idempotent: true,
      },
    },
  },
  tools: [
    {
      name: "artifact_create",
      label: "산출물 만들기",
      description:
        "작업 결과(문서, 표, 계획, 로그 등)를 세션 산출물로 등록한다. 사용자가 나중에 목록에서 찾아 열 수 있다. " +
        "대화에 이미 쓴 짧은 답은 등록하지 않는다.",
      method: "register",
      parameters: ArtifactCreateParams,
      toInput: (p) => ({
        kind: p.kind,
        title: p.title,
        content: {
          type: "inline",
          text: p.text,
          mediaType: p.mediaType ?? (p.kind === "table" ? "text/csv" : "text/markdown"),
        },
        ...(p.summary === undefined ? {} : { meta: { summary: p.summary } }),
        producer: "model",
      }),
      outputSchema: ArtifactSummarySchema,
      toContent: renderArtifact,
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
    {
      name: "artifact_update",
      label: "산출물 고치기",
      description: "등록한 산출물의 새 버전을 만든다. baseVersion은 마지막으로 본 버전 번호다.",
      method: "update",
      parameters: ArtifactUpdateParams,
      toInput: (p) => ({
        artifactId: p.artifactId,
        baseVersion: p.baseVersion,
        ...(p.title === undefined ? {} : { title: p.title }),
        ...(p.text === undefined
          ? {}
          : {
              content: {
                type: "inline",
                text: p.text,
                mediaType: p.mediaType ?? "text/markdown",
              },
            }),
        ...(p.summary === undefined ? {} : { meta: { summary: p.summary } }),
      }),
      outputSchema: ArtifactSummarySchema,
      toContent: renderArtifact,
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const ArtifactsRegistryKey: ServiceKey<CapabilityApi<typeof ArtifactsRegistry>> =
  serviceKey(ArtifactsRegistry);

// ── artifacts.reviews (§3.3) ───────────────────────────────────────────

/**
 * 리뷰할 변경을 어디서 모을지.
 * checkpoint 원본은 M3b에서 지원하지 않는다[미결 §10 11]. open은 source_unsupported를 돌려준다.
 */
export const ChangeSourceSchema: TUnion<
  [
    TObject<{ type: TLiteral<"turn">; turnId: TOptional<typeof TurnIdSchema> }>,
    TObject<{ type: TLiteral<"toolCalls">; toolCallIds: TArray<typeof ToolCallIdSchema> }>,
    TObject<{
      type: TLiteral<"checkpoint">;
      checkpointId: typeof CheckpointIdSchema;
      paths: TOptional<TArray<TString>>;
    }>,
    TObject<{ type: TLiteral<"patch">; patch: TString }>,
  ]
> = Type.Union([
  /** 한 턴의 workspace 쓰기 도구 결과 details.diff 전부. turnId 생략 시 CallContext.turnId */
  Type.Object({ type: Type.Literal("turn"), turnId: Type.Optional(TurnIdSchema) }),
  /** 지정한 도구 호출들의 결과 details.diff */
  Type.Object({
    type: Type.Literal("toolCalls"),
    toolCallIds: Type.Array(ToolCallIdSchema, { minItems: 1, maxItems: 64 }),
  }),
  /** L1 체크포인트의 파일 상태와 현재 파일의 차이. M3b에서는 source_unsupported로 거부된다 */
  Type.Object({
    type: Type.Literal("checkpoint"),
    checkpointId: CheckpointIdSchema,
    paths: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 256 }),
    ),
  }),
  /** 호출자가 준 통합 diff */
  Type.Object({
    type: Type.Literal("patch"),
    patch: Type.String({ minLength: 1, maxLength: 4_194_304 }),
  }),
]);

/**
 * 결정 값. records/catalog/approval.ts의 HunkDecision과 같은 모양이다(§3.3 HunkDecisionSchema).
 */
export const HunkDecisionSchema: TUnion<
  [TLiteral<"pending">, TLiteral<"approved">, TLiteral<"rejected">]
> = Type.Union([Type.Literal("pending"), Type.Literal("approved"), Type.Literal("rejected")]);

export const HunkAppliedSchema: TUnion<
  [TLiteral<"none">, TLiteral<"reverted">, TLiteral<"conflict">]
> = Type.Union([Type.Literal("none"), Type.Literal("reverted"), Type.Literal("conflict")]);

export const HunkViewSchema: TObject<{
  hunkId: typeof HunkIdSchema;
  header: TString;
  oldStart: TInteger;
  oldLines: TInteger;
  newStart: TInteger;
  newLines: TInteger;
  decision: typeof HunkDecisionSchema;
  applied: typeof HunkAppliedSchema;
  commentCount: TInteger;
}> = Type.Object({
  hunkId: HunkIdSchema,
  header: Type.String({ maxLength: 512 }), // "@@ -12,5 +12,7 @@ function foo"
  oldStart: Type.Integer({ minimum: 0 }),
  oldLines: Type.Integer({ minimum: 0 }),
  newStart: Type.Integer({ minimum: 0 }),
  newLines: Type.Integer({ minimum: 0 }),
  decision: HunkDecisionSchema,
  applied: HunkAppliedSchema,
  commentCount: Type.Integer({ minimum: 0 }),
});
export type HunkView = Static<typeof HunkViewSchema>;

export const ReviewFileViewSchema: TObject<{
  fileIndex: TInteger;
  path: TString;
  oldPath: TUnion<[TString, TNull]>;
  change: TUnion<
    [TLiteral<"added">, TLiteral<"modified">, TLiteral<"deleted">, TLiteral<"renamed">]
  >;
  binary: TBoolean;
  hunks: TArray<typeof HunkViewSchema>;
}> = Type.Object({
  fileIndex: Type.Integer({ minimum: 0 }),
  path: Type.String(),
  oldPath: Type.Union([Type.String(), Type.Null()]),
  change: Type.Union([
    Type.Literal("added"),
    Type.Literal("modified"),
    Type.Literal("deleted"),
    Type.Literal("renamed"),
  ]),
  /** 이진 파일은 hunk가 없고 파일 단위로만 결정한다(§4.2.2) */
  binary: Type.Boolean(),
  hunks: Type.Array(HunkViewSchema),
});

/**
 * 코멘트 대상. records/catalog/approval.ts의 ReviewCommentTarget과 같은 모양이다(§3.3 CommentTargetSchema).
 */
export const CommentTargetSchema: TUnion<
  [
    TObject<{
      type: TLiteral<"hunk">;
      hunkId: typeof HunkIdSchema;
      line: TOptional<
        TObject<{ side: TUnion<[TLiteral<"old">, TLiteral<"new">]>; number: TInteger }>
      >;
    }>,
    TObject<{ type: TLiteral<"file">; path: TString }>,
    TObject<{ type: TLiteral<"review"> }>,
  ]
> = Type.Union([
  Type.Object(
    {
      type: Type.Literal("hunk"),
      hunkId: HunkIdSchema,
      line: Type.Optional(
        Type.Object(
          {
            side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
            number: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("file"), path: Type.String({ minLength: 1, maxLength: 4096 }) },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("review") }, { additionalProperties: false }),
]);

export const CommentViewSchema: TObject<{
  commentId: TString;
  target: typeof CommentTargetSchema;
  body: TString;
  round: TInteger;
  deliveredRound: TUnion<[TInteger, TNull]>;
}> = Type.Object({
  commentId: CommentIdSchema,
  target: CommentTargetSchema,
  body: Type.String({ minLength: 1, maxLength: 8000 }),
  round: Type.Integer({ minimum: 1 }),
  /** 에이전트 입력으로 전달된 라운드. 아직이면 null */
  deliveredRound: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
export type CommentView = Static<typeof CommentViewSchema>;

export const ReviewStatusSchema: TUnion<
  [TLiteral<"open">, TLiteral<"submitted">, TLiteral<"closed">]
> = Type.Union([Type.Literal("open"), Type.Literal("submitted"), Type.Literal("closed")]);

export const ReviewViewSchema: TObject<{
  reviewId: TString;
  threadId: typeof ThreadIdSchema;
  artifactId: TString;
  title: TString;
  status: typeof ReviewStatusSchema;
  round: TInteger;
  files: TArray<typeof ReviewFileViewSchema>;
  comments: TArray<typeof CommentViewSchema>;
}> = Type.Object({
  reviewId: ReviewIdSchema,
  threadId: ThreadIdSchema,
  /** 변경 묶음을 담은 changeset 산출물 */
  artifactId: ArtifactIdSchema,
  title: Type.String({ maxLength: 200 }),
  status: ReviewStatusSchema,
  /** 현재 라운드. 열 때 1, 제출할 때마다 1 증가 */
  round: Type.Integer({ minimum: 1 }),
  files: Type.Array(ReviewFileViewSchema),
  comments: Type.Array(CommentViewSchema),
});
export type ReviewView = Static<typeof ReviewViewSchema>;

export const ApplyOutcomeSchema: TObject<{
  path: TString;
  hunkIds: TArray<typeof HunkIdSchema>;
  result: TUnion<[TLiteral<"reverted">, TLiteral<"conflict">, TLiteral<"skipped">]>;
  method: TUnion<[TLiteral<"workspace_files">, TLiteral<"checkpoint_restore">, TLiteral<"none">]>;
  detail: TOptional<TString>;
}> = Type.Object({
  path: Type.String(),
  hunkIds: Type.Array(HunkIdSchema),
  result: Type.Union([Type.Literal("reverted"), Type.Literal("conflict"), Type.Literal("skipped")]),
  /** 되돌림에 쓴 경로. §4.2.5 [미결]의 후보 이름 */
  method: Type.Union([
    Type.Literal("workspace_files"),
    Type.Literal("checkpoint_restore"),
    Type.Literal("none"),
  ]),
  detail: Type.Optional(Type.String({ maxLength: 500 })),
});
export type ApplyOutcome = Static<typeof ApplyOutcomeSchema>;

const HunkSelectionSchema: TUnion<[TArray<typeof HunkIdSchema>, TLiteral<"all">]> = Type.Union([
  Type.Array(HunkIdSchema, { minItems: 1, maxItems: 4096 }),
  Type.Literal("all"),
]);

// 메서드 입력·출력. 같은 모양은 한 번만 적는다.

const OpenInput: TObject<{
  threadId: TOptional<typeof ThreadIdSchema>;
  title: TOptional<TString>;
  changes: typeof ChangeSourceSchema;
  deliverAs: TOptional<typeof PostWhenSchema>;
  requestApproval: TOptional<TBoolean>;
}> = Type.Object({
  threadId: Type.Optional(ThreadIdSchema),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  changes: ChangeSourceSchema,
  /** 제출 시 코멘트를 넣을 전달 모드. 생략하면 l2.artifacts.reviews.deliverAs */
  deliverAs: Type.Optional(PostWhenSchema),
  /** 거짓이면 승인 요청을 내지 않는다(그룹 코드가 직접 결정할 때). 기본 참 */
  requestApproval: Type.Optional(Type.Boolean()),
});

const ReviewOnlyInput: TObject<{ reviewId: TString }> = Type.Object({ reviewId: ReviewIdSchema });

const HunksInput: TObject<{ reviewId: TString; hunks: typeof HunkSelectionSchema }> = Type.Object({
  reviewId: ReviewIdSchema,
  hunks: HunkSelectionSchema,
});

const CommentInput: TObject<{
  reviewId: TString;
  target: typeof CommentTargetSchema;
  body: TString;
}> = Type.Object({
  reviewId: ReviewIdSchema,
  target: CommentTargetSchema,
  body: Type.String({ minLength: 1, maxLength: 8000 }),
});

const SubmitInput: TObject<{
  reviewId: TString;
  deliverAs: TOptional<typeof PostWhenSchema>;
  approveRemaining: TOptional<TBoolean>;
}> = Type.Object({
  reviewId: ReviewIdSchema,
  deliverAs: Type.Optional(PostWhenSchema),
  /** 참이면 남은 pending hunk를 승인으로 본다. 기본 거짓 */
  approveRemaining: Type.Optional(Type.Boolean()),
});

const DeliveryReceipt: TObject<{
  requestId: TString;
  when: typeof PostWhenSchema;
  duplicate: TBoolean;
}> = Type.Object({
  requestId: Type.String(),
  when: PostWhenSchema,
  duplicate: Type.Boolean(),
});

const SubmitOutput: TObject<{
  review: typeof ReviewViewSchema;
  applied: TArray<typeof ApplyOutcomeSchema>;
  delivery: TUnion<[typeof DeliveryReceipt, TNull]>;
}> = Type.Object({
  review: ReviewViewSchema,
  applied: Type.Array(ApplyOutcomeSchema),
  delivery: Type.Union([DeliveryReceipt, Type.Null()]),
});

const CloseInput: TObject<{
  reviewId: TString;
  reason: TUnion<[TLiteral<"done">, TLiteral<"discarded">]>;
}> = Type.Object({
  reviewId: ReviewIdSchema,
  reason: Type.Union([Type.Literal("done"), Type.Literal("discarded")]),
});

/** review_request 도구의 파라미터. 모델에게는 changes를 노출하지 않는다 */
const ReviewRequestParams: TObject<{
  toolCallIds: TOptional<TArray<typeof ToolCallIdSchema>>;
  title: TOptional<TString>;
}> = Type.Object({
  toolCallIds: Type.Optional(Type.Array(ToolCallIdSchema, { minItems: 1, maxItems: 64 })),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

type ReviewsMethods = {
  readonly open: MethodDef<typeof OpenInput, typeof ReviewViewSchema>;
  readonly get: MethodDef<typeof ReviewOnlyInput, typeof ReviewViewSchema>;
  readonly approve: MethodDef<typeof HunksInput, typeof ReviewViewSchema>;
  readonly reject: MethodDef<typeof HunksInput, typeof ReviewViewSchema>;
  readonly comment: MethodDef<typeof CommentInput, typeof CommentViewSchema>;
  readonly submit: MethodDef<typeof SubmitInput, typeof SubmitOutput>;
  readonly close: MethodDef<typeof CloseInput, typeof ReviewViewSchema>;
};

/**
 * 변경 묶음 리뷰. 호출 중복은 CallOptions.requestId로 막는다(idempotent). 입력에 requestId 필드를 두지 않는다.
 * get은 읽기 전용이다.
 */
export const ArtifactsReviews: CapabilityDef<
  ReviewsMethods,
  readonly [ToolSpec<"open", typeof ReviewRequestParams, ReviewsMethods["open"]>]
> = defineCapability({
  id: "artifacts.reviews",
  version: "1.0.0",
  description: "파일 변경을 hunk 단위로 승인·거절하고 코멘트를 에이전트 입력으로 되돌린다.",
  service: {
    methods: {
      open: {
        description:
          "변경을 모아 리뷰를 연다. changeset 산출물을 함께 등록하고 사용자 승인 요청을 낸다.",
        input: OpenInput,
        output: ReviewViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          no_changes: { description: "모은 변경이 없음", retryable: false },
          source_unsupported: {
            description: "이 버전이 지원하지 않는 변경 원본(checkpoint, M3b)",
            retryable: false,
          },
          diff_unparsable: {
            description: "diff를 통합 diff로 해석할 수 없음",
            retryable: false,
            detail: Type.Object({ source: Type.String(), line: Type.Integer({ minimum: 0 }) }),
          },
          review_too_large: { description: "파일 수나 hunk 수가 상한을 넘음", retryable: false },
        },
      },
      get: {
        description: "리뷰 상태를 돌려준다.",
        input: ReviewOnlyInput,
        output: ReviewViewSchema,
        replay: "safe",
        readOnly: true,
      },
      approve: {
        description: "hunk를 승인으로 표시한다.",
        input: HunksInput,
        output: ReviewViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          review_closed: { description: "닫힌 리뷰", retryable: false },
          hunk_unknown: { description: "리뷰에 없는 hunkId", retryable: false },
        },
      },
      reject: {
        description: "hunk를 거절로 표시한다. 되돌림은 submit에서 적용한다.",
        input: HunksInput,
        output: ReviewViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          review_closed: { description: "닫힌 리뷰", retryable: false },
          hunk_unknown: { description: "리뷰에 없는 hunkId", retryable: false },
        },
      },
      comment: {
        description: "hunk의 줄, 파일, 리뷰 전체에 코멘트를 단다.",
        input: CommentInput,
        output: CommentViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          review_closed: { description: "닫힌 리뷰", retryable: false },
          hunk_unknown: { description: "리뷰에 없는 hunkId", retryable: false },
          line_out_of_range: { description: "줄 번호가 hunk 범위 밖", retryable: false },
        },
      },
      submit: {
        description:
          "현재 라운드를 확정한다. 거절 hunk를 되돌리고 결정·코멘트를 에이전트 입력으로 넣는다.",
        input: SubmitInput,
        output: SubmitOutput,
        replay: "safe",
        idempotent: true,
        errors: {
          review_closed: { description: "닫힌 리뷰", retryable: false },
          decisions_pending: {
            description: "pending hunk가 남았고 approveRemaining이 거짓",
            retryable: false,
          },
          revert_unavailable: {
            description: "거절 적용 경로(§4.2.5)를 쓸 수 없음",
            retryable: true,
          },
        },
      },
      close: {
        description: "리뷰를 닫는다. 이후 결정·코멘트를 받지 않는다.",
        input: CloseInput,
        output: ReviewViewSchema,
        replay: "safe",
        idempotent: true,
      },
    },
  },
  tools: [
    {
      // [제안] 모델이 사용자 리뷰를 요청하는 도구. 기본 노출 여부는 l2.artifacts.tools.reviewRequest
      name: "review_request",
      label: "변경 리뷰 요청",
      description:
        "이번 턴(또는 지정한 도구 호출)에서 바꾼 파일을 사용자 리뷰에 올린다. 결과를 기다리지 않는다. " +
        "사용자의 결정과 코멘트는 나중에 사용자 입력으로 들어온다.",
      method: "open",
      parameters: ReviewRequestParams,
      toInput: (p) => ({
        changes:
          p.toolCallIds === undefined
            ? { type: "turn" }
            : { type: "toolCalls", toolCallIds: p.toolCallIds },
        ...(p.title === undefined ? {} : { title: p.title }),
      }),
      outputSchema: ReviewViewSchema,
      toContent: (out) => ({
        content: [
          {
            type: "text",
            text:
              `review ${out.reviewId} opened: ${out.files.length} files, ` +
              `${out.files.reduce((n, f) => n + f.hunks.length, 0)} hunks. Decisions arrive as later user input.`,
          },
        ],
        structuredContent: out,
      }),
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const ArtifactsReviewsKey: ServiceKey<CapabilityApi<typeof ArtifactsReviews>> =
  serviceKey(ArtifactsReviews);

// ── artifacts.sessions (§3.4) ──────────────────────────────────────────
// [결정: M3b B2-ART] handoff·export와 handoff 도구는 2차라 정의에 넣지 않는다.

/**
 * 라벨 한 개. NFC 정규화와 앞뒤 공백 제거는 구현이 한다. \p{L}·\p{N}은 u 플래그로 해석된다
 * (TypeBox Compile·Value.Check가 그렇게 검증한다, artifacts-defs.test). 라벨은 도구 파라미터에 없어 모델에 광고되지 않는다.
 */
export const LabelSchema: TString = Type.String({
  pattern: "^[\\p{L}\\p{N}][\\p{L}\\p{N} ._/-]{0,47}$",
});

export const SessionMetaViewSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  title: TUnion<[TString, TNull]>;
  titleSource: TUnion<[TLiteral<"user">, TLiteral<"auto">, TLiteral<"model">, TNull]>;
  labels: TArray<typeof LabelSchema>;
  workspace: TUnion<[TString, TNull]>;
  artifactCount: TInteger;
  handoffFrom: TUnion<[typeof ThreadIdSchema, TNull]>;
  createdAt: TInteger;
  updatedAt: TInteger;
}> = Type.Object({
  threadId: ThreadIdSchema,
  title: Type.Union([Type.String(), Type.Null()]),
  /** 제목을 정한 쪽. 제목 이벤트의 source에서 투영한다(§4.3.1) */
  titleSource: Type.Union([
    Type.Literal("user"),
    Type.Literal("auto"),
    Type.Literal("model"),
    Type.Null(),
  ]),
  labels: Type.Array(LabelSchema),
  workspace: Type.Union([Type.String(), Type.Null()]),
  artifactCount: Type.Integer({ minimum: 0 }),
  handoffFrom: Type.Union([ThreadIdSchema, Type.Null()]),
  createdAt: Type.Integer({ minimum: 0 }),
  updatedAt: Type.Integer({ minimum: 0 }),
});
export type SessionMetaView = Static<typeof SessionMetaViewSchema>;

const SetMetaInput: TObject<{
  threadId: TOptional<typeof ThreadIdSchema>;
  title: TOptional<TString>;
  labels: TOptional<
    TObject<{
      set: TOptional<TArray<typeof LabelSchema>>;
      add: TOptional<TArray<typeof LabelSchema>>;
      remove: TOptional<TArray<typeof LabelSchema>>;
    }>
  >;
}> = Type.Object({
  threadId: Type.Optional(ThreadIdSchema),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  labels: Type.Optional(
    Type.Object({
      set: Type.Optional(Type.Array(LabelSchema, { maxItems: 32, uniqueItems: true })),
      add: Type.Optional(Type.Array(LabelSchema, { minItems: 1, maxItems: 32 })),
      remove: Type.Optional(Type.Array(LabelSchema, { minItems: 1, maxItems: 32 })),
    }),
  ),
});

const SessionsListInput: TObject<{
  labels: TOptional<TArray<typeof LabelSchema>>;
  workspace: TOptional<TString>;
  order: TOptional<TUnion<[TLiteral<"updated">, TLiteral<"created">]>>;
  cursor: TOptional<TString>;
  limit: TOptional<TInteger>;
}> = Type.Object({
  labels: Type.Optional(Type.Array(LabelSchema, { minItems: 1, maxItems: 8 })),
  workspace: Type.Optional(Type.String({ maxLength: 4096 })),
  order: Type.Optional(Type.Union([Type.Literal("updated"), Type.Literal("created")])),
  cursor: Type.Optional(Type.String({ maxLength: 128 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

const SessionsListOutput: TObject<{
  items: TArray<typeof SessionMetaViewSchema>;
  nextCursor: TUnion<[TString, TNull]>;
}> = Type.Object({
  items: Type.Array(SessionMetaViewSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

const SessionsSearchInput: TObject<{
  query: TString;
  labels: TOptional<TArray<typeof LabelSchema>>;
  limit: TOptional<TInteger>;
}> = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200 }),
  labels: Type.Optional(Type.Array(LabelSchema, { minItems: 1, maxItems: 8 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});

const SessionsSearchOutput: TObject<{ items: TArray<typeof SessionMetaViewSchema> }> = Type.Object({
  items: Type.Array(SessionMetaViewSchema),
});

const SessionRenameParams: TObject<{ title: TString }> = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
});

type SessionsMethods = {
  readonly setMeta: MethodDef<typeof SetMetaInput, typeof SessionMetaViewSchema>;
  readonly list: MethodDef<typeof SessionsListInput, typeof SessionsListOutput>;
  readonly search: MethodDef<typeof SessionsSearchInput, typeof SessionsSearchOutput>;
};

/**
 * 세션 제목·라벨 메타와 메타 검색. setMeta는 requestId로 멱등이고, list·search는 읽기 전용이다.
 * handoff·export는 2차라 이 정의에 없다.
 */
export const ArtifactsSessions: CapabilityDef<
  SessionsMethods,
  readonly [ToolSpec<"setMeta", typeof SessionRenameParams, SessionsMethods["setMeta"]>]
> = defineCapability({
  id: "artifacts.sessions",
  version: "1.0.0",
  description: "세션 제목·라벨 메타와 메타 검색.",
  service: {
    methods: {
      setMeta: {
        description: "세션 제목과 라벨을 바꾼다. 제목은 xeon.session 제목 변경 API로 기록한다.",
        input: SetMetaInput,
        output: SessionMetaViewSchema,
        replay: "safe",
        idempotent: true,
        errors: {
          too_many_labels: { description: "라벨이 32개를 넘음", retryable: false },
        },
      },
      list: {
        description: "세션 메타 목록. 라벨·작업 공간으로 거른다.",
        input: SessionsListInput,
        output: SessionsListOutput,
        replay: "safe",
        readOnly: true,
      },
      search: {
        description:
          "제목과 라벨에서 부분 문자열로 세션을 찾는다. 대화 본문은 찾지 않는다(knowledge.search).",
        input: SessionsSearchInput,
        output: SessionsSearchOutput,
        replay: "safe",
        readOnly: true,
      },
    },
  },
  tools: [
    {
      // [제안] 기본 노출 여부는 l2.artifacts.tools.sessionRename
      name: "session_rename",
      label: "세션 이름 바꾸기",
      description: "현재 세션의 제목을 바꾼다. 사용자가 이름을 요청했을 때만 쓴다.",
      method: "setMeta",
      parameters: SessionRenameParams,
      toInput: (p) => ({ title: p.title }),
      toContent: (out) => ({ content: [{ type: "text", text: `title: ${out.title ?? ""}` }] }),
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const ArtifactsSessionsKey: ServiceKey<CapabilityApi<typeof ArtifactsSessions>> =
  serviceKey(ArtifactsSessions);

/** 산출물·세션 묶음. WORK_CAPABILITIES와 같은 방식이다 */
export const ARTIFACTS_CAPABILITIES: readonly [
  typeof ArtifactsRegistry,
  typeof ArtifactsReviews,
  typeof ArtifactsSessions,
] = [ArtifactsRegistry, ArtifactsReviews, ArtifactsSessions];
