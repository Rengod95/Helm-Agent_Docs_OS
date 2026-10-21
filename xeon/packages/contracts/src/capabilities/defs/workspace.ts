import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TNumber,
  type TObject,
  type TOptional,
  type TRecord,
  type TString,
  type TUnion,
} from "typebox";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolContent, ToolSpec } from "../tool-spec.ts";

/** 모델과 그룹 코드가 넘기는 경로. 상대 경로는 cwd 기준. 앞의 "@"는 지운다(L2.workspace.spec §4.3) */
const PathParam = Type.String({
  minLength: 1,
  maxLength: 4096,
  description: "파일 경로(상대 또는 절대)",
});

// ── 공통 스키마 (L2.workspace.spec §3.1) ────────────────────────────────

/** 절단 정보. 절단이 없으면 필드 자체를 두지 않는다 */
export const TruncationInfoSchema: TObject<{
  by: TUnion<[TLiteral<"lines">, TLiteral<"bytes">, TLiteral<"entries">]>;
  shown: TInteger;
  total: TOptional<TInteger>;
  nextOffset: TOptional<TInteger>;
}> = Type.Object(
  {
    /** 어느 한도에 걸렸는가. entries는 grep·find·ls의 개수 한도 */
    by: Type.Union([Type.Literal("lines"), Type.Literal("bytes"), Type.Literal("entries")]),
    /** 결과에 담은 단위 수(줄 또는 항목) */
    shown: Type.Integer({ minimum: 0 }),
    /** 전체 단위 수. 끝까지 세지 않는 도구(grep, find)는 알 수 없을 때 생략한다 */
    total: Type.Optional(Type.Integer({ minimum: 0 })),
    /** read 전용. 이어 읽을 때 넘길 offset(1부터) */
    nextOffset: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export type TruncationInfo = Static<typeof TruncationInfoSchema>;

/**
 * F.records.spec §3.4 BlobRef와 같은 모양. capabilities는 records를 import하지 않으므로(F.readme §3 순서 표)
 * 같은 모양을 여기 적는다. 두 스키마의 일치는 test/capabilities/workspace-defs.test.ts가 확인한다.
 */
export const ImageBlobRefSchema: TObject<{
  type: TLiteral<"blob">;
  sha256: TString;
  size: TInteger;
  mediaType: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    type: Type.Literal("blob"),
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$", minLength: 64, maxLength: 64 }),
    size: Type.Integer({ minimum: 0 }),
    mediaType: Type.Union([Type.String({ minLength: 1, maxLength: 127 }), Type.Null()]),
  },
  { additionalProperties: false },
);

const PixelSize: TObject<{ width: TInteger; height: TInteger }> = Type.Object(
  { width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const ImageLimitsSchema: TObject<{
  maxWidth: TInteger;
  maxHeight: TInteger;
  maxBytes: TInteger;
}> = Type.Object(
  {
    maxWidth: Type.Integer({ minimum: 1, maximum: 16384 }),
    maxHeight: Type.Integer({ minimum: 1, maximum: 16384 }),
    /** base64 길이 기준 바이트 */
    maxBytes: Type.Integer({ minimum: 1024 }),
  },
  { additionalProperties: false },
);
export type ImageLimits = Static<typeof ImageLimitsSchema>;

/** 모델에 넘길 수 있게 준비된 이미지 */
export const WorkspaceImageSchema: TObject<{
  blob: typeof ImageBlobRefSchema;
  mimeType: TString;
  size: TOptional<typeof PixelSize>;
  resized: TOptional<TObject<{ from: typeof PixelSize; to: typeof PixelSize }>>;
  convertedFrom: TOptional<TString>;
}> = Type.Object(
  {
    blob: ImageBlobRefSchema,
    /** image/png, image/jpeg, image/gif, image/webp 중 하나 */
    mimeType: Type.String({ maxLength: 127 }),
    /** 처리기가 없으면 알 수 없다 */
    size: Type.Optional(PixelSize),
    resized: Type.Optional(
      Type.Object({ from: PixelSize, to: PixelSize }, { additionalProperties: false }),
    ),
    /** 원래 형식이 mimeType과 다를 때. 예: image/bmp → image/png */
    convertedFrom: Type.Optional(Type.String({ maxLength: 127 })),
  },
  { additionalProperties: false },
);
export type WorkspaceImage = Static<typeof WorkspaceImageSchema>;

/** 쓰기·편집 결과의 변경 기록. artifacts.reviews와 UI가 읽는다 */
export const FileChangeSchema: TObject<{
  path: TString;
  existed: TBoolean;
  diff: TString;
  added: TInteger;
  removed: TInteger;
  firstChangedLine: TOptional<TInteger>;
}> = Type.Object(
  {
    /** 정규 경로 */
    path: Type.String({ maxLength: 4096 }),
    /** 쓰기 전 파일이 있었는가 */
    existed: Type.Boolean(),
    /** unified diff. 파일 이름 줄은 a/<상대 경로>, b/<상대 경로> */
    diff: Type.String(),
    added: Type.Integer({ minimum: 0 }),
    removed: Type.Integer({ minimum: 0 }),
    /** 처음 바뀐 줄(1부터). 바뀐 줄이 없으면 생략 */
    firstChangedLine: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export type FileChange = Static<typeof FileChangeSchema>;

// ── workspace.files (§3.2) ──────────────────────────────────────────────

export const ReadInput: TObject<{
  path: TString;
  offset: TOptional<TInteger>;
  limit: TOptional<TInteger>;
}> = Type.Object(
  {
    path: PathParam,
    offset: Type.Optional(Type.Integer({ minimum: 1, description: "읽기 시작 줄(1부터)" })),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100_000, description: "읽을 최대 줄 수" }),
    ),
  },
  { additionalProperties: false },
);

const ReadTextOutput: TObject<{
  kind: TLiteral<"text">;
  path: TString;
  text: TString;
  startLine: TInteger;
  endLine: TInteger;
  totalLines: TInteger;
  truncated: TOptional<typeof TruncationInfoSchema>;
}> = Type.Object(
  {
    kind: Type.Literal("text"),
    path: Type.String({ maxLength: 4096 }),
    text: Type.String(),
    startLine: Type.Integer({ minimum: 1 }),
    endLine: Type.Integer({ minimum: 0 }),
    totalLines: Type.Integer({ minimum: 0 }),
    truncated: Type.Optional(TruncationInfoSchema),
  },
  { additionalProperties: false },
);
const ReadImageOutput: TObject<{
  kind: TLiteral<"image">;
  path: TString;
  image: typeof WorkspaceImageSchema;
}> = Type.Object(
  {
    kind: Type.Literal("image"),
    path: Type.String({ maxLength: 4096 }),
    image: WorkspaceImageSchema,
  },
  { additionalProperties: false },
);
export const ReadOutput: TUnion<[typeof ReadTextOutput, typeof ReadImageOutput]> = Type.Union([
  ReadTextOutput,
  ReadImageOutput,
]);

export const WriteInput: TObject<{ path: TString; content: TString }> = Type.Object(
  {
    path: PathParam,
    /** 파일에 쓸 전체 내용 */
    content: Type.String(),
  },
  { additionalProperties: false },
);
export const WriteOutput: TObject<{ bytes: TInteger; change: typeof FileChangeSchema }> =
  Type.Object(
    { bytes: Type.Integer({ minimum: 0 }), change: FileChangeSchema },
    { additionalProperties: false },
  );

const Replacement: TObject<{ oldText: TString; newText: TString }> = Type.Object(
  {
    /** 바꿀 원문. 원본 파일에서 한 곳에만 있어야 하고 다른 편집과 겹치면 안 된다 */
    oldText: Type.String(),
    /** 바꿀 내용 */
    newText: Type.String(),
  },
  { additionalProperties: false },
);
export const EditInput: TObject<{ path: TString; edits: TArray<typeof Replacement> }> = Type.Object(
  { path: PathParam, edits: Type.Array(Replacement, { minItems: 1, maxItems: 64 }) },
  { additionalProperties: false },
);
/** 모델 도구 파라미터. 모델이 자주 보내는 변형(문자열로 된 edits, 단일 객체, 최상위 oldText/newText)을 받는다 */
export const EditToolParams: TObject<{
  path: TString;
  edits: TOptional<TUnion<[TArray<typeof Replacement>, typeof Replacement, TString]>>;
  oldText: TOptional<TString>;
  newText: TOptional<TString>;
}> = Type.Object(
  {
    path: PathParam,
    edits: Type.Optional(
      Type.Union([Type.Array(Replacement, { maxItems: 64 }), Replacement, Type.String()], {
        description: "편집 목록. 각 편집은 원본 파일 기준으로 찾는다. 겹치는 편집은 하나로 합친다",
      }),
    ),
    oldText: Type.Optional(Type.String()),
    newText: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const EditOutput: TObject<{
  applied: TInteger;
  matchMode: TUnion<[TLiteral<"exact">, TLiteral<"fuzzy">]>;
  change: typeof FileChangeSchema;
}> = Type.Object(
  {
    applied: Type.Integer({ minimum: 1 }),
    matchMode: Type.Union([Type.Literal("exact"), Type.Literal("fuzzy")]),
    change: FileChangeSchema,
  },
  { additionalProperties: false },
);

/** 도구 이름 ls의 입력 */
export const ListInput: TObject<{ path: TOptional<TString>; limit: TOptional<TInteger> }> =
  Type.Object(
    {
      path: Type.Optional(PathParam),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    },
    { additionalProperties: false },
  );
const ListEntry: TObject<{
  name: TString;
  kind: TUnion<[TLiteral<"file">, TLiteral<"directory">, TLiteral<"symlink">]>;
}> = Type.Object(
  {
    name: Type.String({ maxLength: 4096 }),
    kind: Type.Union([Type.Literal("file"), Type.Literal("directory"), Type.Literal("symlink")]),
  },
  { additionalProperties: false },
);
export const ListOutput: TObject<{
  path: TString;
  entries: TArray<typeof ListEntry>;
  truncated: TOptional<typeof TruncationInfoSchema>;
}> = Type.Object(
  {
    path: Type.String({ maxLength: 4096 }),
    /** 이름 바이트 순. 점 파일 포함 */
    entries: Type.Array(ListEntry, { maxItems: 10_000 }),
    truncated: Type.Optional(TruncationInfoSchema),
  },
  { additionalProperties: false },
);

export const GrepInput: TObject<{
  pattern: TString;
  path: TOptional<TString>;
  glob: TOptional<TString>;
  ignoreCase: TOptional<TBoolean>;
  literal: TOptional<TBoolean>;
  context: TOptional<TInteger>;
  limit: TOptional<TInteger>;
}> = Type.Object(
  {
    pattern: Type.String({
      minLength: 1,
      maxLength: 4096,
      description: "정규식 또는 literal이 참이면 문자열",
    }),
    path: Type.Optional(PathParam),
    glob: Type.Optional(Type.String({ maxLength: 512, description: "파일 거르기 glob. 예: *.ts" })),
    ignoreCase: Type.Optional(Type.Boolean()),
    literal: Type.Optional(Type.Boolean()),
    context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  },
  { additionalProperties: false },
);
const GrepMatch: TObject<{
  path: TString;
  line: TInteger;
  text: TString;
  kind: TUnion<[TLiteral<"match">, TLiteral<"context">]>;
}> = Type.Object(
  {
    path: Type.String({ maxLength: 4096 }),
    line: Type.Integer({ minimum: 1 }),
    text: Type.String(),
    kind: Type.Union([Type.Literal("match"), Type.Literal("context")]),
  },
  { additionalProperties: false },
);
export const GrepOutput: TObject<{
  root: TString;
  matches: TArray<typeof GrepMatch>;
  truncated: TOptional<typeof TruncationInfoSchema>;
}> = Type.Object(
  {
    /** 검색 기준 디렉터리(정규 경로). matches의 path는 이 기준 상대 경로 */
    root: Type.String({ maxLength: 4096 }),
    matches: Type.Array(GrepMatch, { maxItems: 100_000 }),
    truncated: Type.Optional(TruncationInfoSchema),
  },
  { additionalProperties: false },
);

export const FindInput: TObject<{
  pattern: TString;
  path: TOptional<TString>;
  limit: TOptional<TInteger>;
}> = Type.Object(
  {
    pattern: Type.String({
      minLength: 1,
      maxLength: 512,
      description: "파일 glob. 예: **/*.spec.ts",
    }),
    path: Type.Optional(PathParam),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  },
  { additionalProperties: false },
);
export const FindOutput: TObject<{
  root: TString;
  paths: TArray<TString>;
  truncated: TOptional<typeof TruncationInfoSchema>;
}> = Type.Object(
  {
    root: Type.String({ maxLength: 4096 }),
    /** root 기준 상대 경로, 바이트 순 */
    paths: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100_000 }),
    truncated: Type.Optional(TruncationInfoSchema),
  },
  { additionalProperties: false },
);

// ── 렌더링과 입력 변환(순수 함수) ───────────────────────────────────────

function truncNote(t: TruncationInfo | undefined): string {
  if (t === undefined) return "";
  const total = t.total === undefined ? "" : ` / 전체 ${t.total}`;
  const next = t.nextOffset === undefined ? "" : ` 이어 읽기: offset=${t.nextOffset}`;
  return `\n\n[절단: ${t.by} 한도, ${t.shown}${total}.${next}]`;
}

function renderRead(out: Static<typeof ReadOutput>): ToolContent {
  if (out.kind === "image") {
    return {
      content: [
        {
          type: "text",
          text: `${out.path} (${out.image.mimeType}${out.image.resized ? ", 크기 조정됨" : ""})`,
        },
        // data는 자리표시 문자열이다. L1.context가 요청 직전에 blob 내용으로 바꾼다(L2.workspace.spec §4.6)
        {
          type: "image",
          data: `blob:sha256:${out.image.blob.sha256}`,
          mimeType: out.image.mimeType,
        },
      ],
      structuredContent: out,
    };
  }
  return {
    content: [{ type: "text", text: out.text + truncNote(out.truncated) }],
    structuredContent: out,
  };
}

function renderChange(verb: string): (out: { change: FileChange }) => ToolContent {
  return (out) => ({
    content: [
      {
        type: "text",
        text: `${verb}: ${out.change.path} (+${out.change.added} -${out.change.removed})`,
      },
    ],
    structuredContent: out,
    details: out.change,
  });
}

function renderList(out: Static<typeof ListOutput>): ToolContent {
  const lines = out.entries.map((e) => (e.kind === "directory" ? `${e.name}/` : e.name));
  return {
    content: [{ type: "text", text: lines.join("\n") + truncNote(out.truncated) }],
    structuredContent: out,
  };
}

function renderGrep(out: Static<typeof GrepOutput>): ToolContent {
  const lines = out.matches.map((m) => {
    const sep = m.kind === "match" ? ":" : "-";
    return `${m.path}${sep}${m.line}${sep} ${m.text}`;
  });
  return {
    content: [{ type: "text", text: lines.join("\n") + truncNote(out.truncated) }],
    structuredContent: out,
  };
}

function renderFind(out: Static<typeof FindOutput>): ToolContent {
  return {
    content: [{ type: "text", text: out.paths.join("\n") + truncNote(out.truncated) }],
    structuredContent: out,
  };
}

function isReplacement(value: unknown): value is Static<typeof Replacement> {
  return (
    typeof value === "object" &&
    value !== null &&
    "oldText" in value &&
    "newText" in value &&
    typeof value.oldText === "string" &&
    typeof value.newText === "string"
  );
}

/** EditToolParams → EditInput. 순수 함수. durable tools/edit.ts prepareEditArguments의 규칙을 옮긴다 */
function toEditInput(p: Static<typeof EditToolParams>): Static<typeof EditInput> {
  let edits: unknown = p.edits;
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits);
    } catch {
      edits = [];
    }
  }
  if (edits !== undefined && !Array.isArray(edits)) edits = [edits];
  const list: Static<typeof Replacement>[] = Array.isArray(edits)
    ? (edits as readonly unknown[]).filter(isReplacement)
    : [];
  if (list.length === 0 && typeof p.oldText === "string" && typeof p.newText === "string") {
    return { path: p.path, edits: [{ oldText: p.oldText, newText: p.newText }] };
  }
  return { path: p.path, edits: list };
}

const READ_ONLY = { readOnly: true, idempotent: true } as const;

type FilesMethods = {
  readonly read: MethodDef<typeof ReadInput, typeof ReadOutput>;
  readonly write: MethodDef<typeof WriteInput, typeof WriteOutput>;
  readonly edit: MethodDef<typeof EditInput, typeof EditOutput>;
  readonly list: MethodDef<typeof ListInput, typeof ListOutput>;
  readonly grep: MethodDef<typeof GrepInput, typeof GrepOutput>;
  readonly find: MethodDef<typeof FindInput, typeof FindOutput>;
};

export const WorkspaceFiles: CapabilityDef<
  FilesMethods,
  readonly [
    ToolSpec<"read", typeof ReadInput, FilesMethods["read"]>,
    ToolSpec<"write", typeof WriteInput, FilesMethods["write"]>,
    ToolSpec<"edit", typeof EditToolParams, FilesMethods["edit"]>,
    ToolSpec<"list", typeof ListInput, FilesMethods["list"]>,
    ToolSpec<"grep", typeof GrepInput, FilesMethods["grep"]>,
    ToolSpec<"find", typeof FindInput, FilesMethods["find"]>,
  ]
> = defineCapability({
  id: "workspace.files",
  version: "1.0.0",
  description: "작업 디렉터리의 파일 읽기, 쓰기, 편집, 목록, 내용 검색, 파일 찾기.",
  service: {
    methods: {
      read: {
        description: "텍스트 파일을 줄 범위로 읽는다. 이미지 파일이면 이미지 참조를 돌려준다.",
        input: ReadInput,
        output: ReadOutput,
        replay: "safe",
        errors: {
          read_binary: { description: "이미지가 아닌 바이너리 파일", retryable: false },
          offset_beyond_end: { description: "offset이 파일 줄 수보다 큼", retryable: false },
        },
      },
      write: {
        description: "파일 전체를 쓴다. 없으면 만들고 부모 디렉터리도 만든다.",
        input: WriteInput,
        output: WriteOutput,
        replay: "unsafe",
      },
      edit: {
        description:
          "원본 기준으로 찾은 구간들을 한 번에 바꾼다. 정확 일치를 먼저 쓰고 실패하면 퍼지 일치를 쓴다.",
        input: EditInput,
        output: EditOutput,
        replay: "unsafe",
        errors: {
          edit_not_found: { description: "oldText를 찾지 못함", retryable: false },
          edit_ambiguous: { description: "oldText가 두 곳 이상에 있음", retryable: false },
          edit_overlap: { description: "두 편집의 구간이 겹침", retryable: false },
          edit_empty_old_text: { description: "oldText가 빈 문자열", retryable: false },
          edit_no_change: { description: "편집 결과가 원본과 같음", retryable: false },
        },
      },
      list: {
        description: "디렉터리 항목을 이름 순으로 돌려준다.",
        input: ListInput,
        output: ListOutput,
        replay: "safe",
      },
      grep: {
        description: "파일 내용을 정규식이나 문자열로 검색한다. .gitignore를 따른다.",
        input: GrepInput,
        output: GrepOutput,
        replay: "safe",
        errors: { pattern_invalid: { description: "정규식 문법 오류", retryable: false } },
      },
      find: {
        description: "glob으로 파일을 찾는다. .gitignore를 따른다.",
        input: FindInput,
        output: FindOutput,
        replay: "safe",
        errors: { pattern_invalid: { description: "glob 문법 오류", retryable: false } },
      },
    },
  },
  tools: [
    {
      name: "read",
      label: "파일 읽기",
      method: "read",
      parameters: ReadInput,
      description:
        "파일 내용을 읽는다. 큰 파일은 설정된 줄·바이트 한도에서 잘리고 이어 읽을 offset을 알려 준다. 이미지 파일은 이미지로 돌려준다.",
      toContent: renderRead,
      replay: "safe",
      executionMode: "parallel",
      hints: READ_ONLY,
    },
    {
      name: "write",
      label: "파일 쓰기",
      method: "write",
      parameters: WriteInput,
      description: "파일에 내용을 통째로 쓴다. 기존 파일은 덮어쓴다. 부분 수정은 edit를 쓴다.",
      toContent: renderChange("썼음"),
      replay: "unsafe",
      executionMode: "parallel",
      hints: { readOnly: false, destructive: true, idempotent: true },
    },
    {
      name: "edit",
      label: "파일 편집",
      method: "edit",
      parameters: EditToolParams,
      toInput: toEditInput,
      description:
        "파일의 특정 구간을 바꾼다. oldText는 원본에서 한 곳에만 있어야 한다. 여러 편집은 edits 배열로 한 번에 보낸다.",
      toContent: renderChange("편집함"),
      replay: "unsafe",
      executionMode: "parallel",
      hints: { readOnly: false, destructive: true, idempotent: false },
    },
    {
      name: "ls",
      label: "디렉터리 목록",
      method: "list",
      parameters: ListInput,
      description:
        "디렉터리 항목을 이름 순으로 보여 준다. 디렉터리는 끝에 /를 붙인다. 점 파일을 포함한다.",
      toContent: renderList,
      replay: "safe",
      executionMode: "parallel",
      hints: READ_ONLY,
    },
    {
      name: "grep",
      label: "내용 검색",
      method: "grep",
      parameters: GrepInput,
      description:
        "파일 내용을 검색해 경로와 줄 번호를 돌려준다. .gitignore를 따른다. 결과 수와 줄 길이에 한도가 있다.",
      toContent: renderGrep,
      replay: "safe",
      executionMode: "parallel",
      hints: READ_ONLY,
    },
    {
      name: "find",
      label: "파일 찾기",
      method: "find",
      parameters: FindInput,
      description:
        "glob 패턴으로 파일을 찾아 기준 디렉터리 상대 경로를 돌려준다. .gitignore를 따른다.",
      toContent: renderFind,
      replay: "safe",
      executionMode: "parallel",
      hints: READ_ONLY,
    },
  ],
});
export const WorkspaceFilesKey: ServiceKey<CapabilityApi<typeof WorkspaceFiles>> =
  serviceKey(WorkspaceFiles);

// ── workspace.shell (§3.3) ──────────────────────────────────────────────

const EnvName = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$" });
/** F.wire-settings.spec §3.8.1 SecretRef와 같은 형식 */
const SecretRefParam = Type.String({ pattern: "^secret://[a-z][a-z0-9-]{1,63}$", maxLength: 75 });

export const RunInput: TObject<{
  command: TString;
  timeoutSec: TOptional<TNumber>;
  cwd: TOptional<TString>;
  failOnNonZero: TOptional<TBoolean>;
  secretEnv: TOptional<TRecord<"^.*$", TString>>;
}> = Type.Object(
  {
    command: Type.String({ minLength: 1, maxLength: 131_072 }),
    /** 초. 생략하면 설정 l2.workspace.shell.defaultTimeoutSec(0이면 제한 없음) */
    timeoutSec: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 86_400 })),
    /** 생략하면 세션 cwd. 허용 root 안이어야 한다 */
    cwd: Type.Optional(PathParam),
    /** 참이면 0이 아닌 종료 코드를 exit_nonzero 오류로 낸다. 모델 도구는 항상 참이다 */
    failOnNonZero: Type.Optional(Type.Boolean()),
    /** 그룹 코드가 비밀을 명시적으로 넘길 때만 쓴다. 값 주입은 xeon.exec가 실행 직전에 한다 */
    secretEnv: Type.Optional(Type.Record(EnvName, SecretRefParam)),
  },
  { additionalProperties: false },
);
export const RunOutput: TObject<{
  exitCode: TInteger;
  output: TString;
  truncated: TBoolean;
  fullOutputPath: TOptional<TString>;
  durationMs: TInteger;
  sandboxed: TBoolean;
}> = Type.Object(
  {
    exitCode: Type.Integer(),
    /** stdout과 stderr를 합친 출력의 남긴 꼬리 */
    output: Type.String(),
    truncated: Type.Boolean(),
    /** 한도를 넘어 파일로 넘긴 전체 출력의 경로 */
    fullOutputPath: Type.Optional(Type.String({ maxLength: 4096 })),
    durationMs: Type.Integer({ minimum: 0 }),
    /** 샌드박스 안에서 실행했는가 */
    sandboxed: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const BashToolParams: TObject<{ command: TString; timeout: TOptional<TNumber> }> =
  Type.Object(
    {
      command: Type.String({ minLength: 1, maxLength: 131_072, description: "실행할 bash 명령" }),
      timeout: Type.Optional(
        Type.Number({ exclusiveMinimum: 0, maximum: 86_400, description: "제한 시간(초)" }),
      ),
    },
    { additionalProperties: false },
  );

function renderRun(out: Static<typeof RunOutput>): ToolContent {
  const head = out.truncated
    ? `[앞부분 생략${out.fullOutputPath ? `, 전체 출력: ${out.fullOutputPath}` : ""}]\n`
    : "";
  return { content: [{ type: "text", text: head + out.output }], structuredContent: out };
}

type ShellMethods = {
  readonly run: MethodDef<typeof RunInput, typeof RunOutput>;
};

export const WorkspaceShell: CapabilityDef<
  ShellMethods,
  readonly [ToolSpec<"run", typeof BashToolParams, ShellMethods["run"]>]
> = defineCapability({
  id: "workspace.shell",
  version: "1.0.0",
  description: "작업 디렉터리에서 셸 명령을 실행한다. 샌드박스가 켜져 있으면 그 안에서 실행한다.",
  service: {
    methods: {
      run: {
        description: "bash 명령을 실행하고 종료 코드와 출력 꼬리를 돌려준다.",
        input: RunInput,
        output: RunOutput,
        replay: "unsafe",
        errors: {
          exit_nonzero: {
            description: "failOnNonZero가 참이고 종료 코드가 0이 아님. detail에 RunOutput을 싣는다",
            retryable: false,
            detail: RunOutput,
          },
        },
      },
    },
  },
  tools: [
    {
      name: "bash",
      label: "셸 명령",
      method: "run",
      parameters: BashToolParams,
      toInput: (p) => ({
        command: p.command,
        failOnNonZero: true,
        ...(p.timeout === undefined ? {} : { timeoutSec: p.timeout }),
      }),
      description:
        "현재 작업 디렉터리에서 bash 명령을 실행한다. stdout과 stderr를 합쳐 돌려준다. 출력이 한도를 넘으면 마지막 부분만 남기고 전체는 임시 파일에 둔다. 제한 시간을 초로 줄 수 있다.",
      toContent: renderRun,
      replay: "unsafe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: true, idempotent: false, openWorld: true },
    },
  ],
});
export const WorkspaceShellKey: ServiceKey<CapabilityApi<typeof WorkspaceShell>> =
  serviceKey(WorkspaceShell);

// ── workspace.images (§3.4) ─────────────────────────────────────────────

export const LoadImageInput: TObject<{
  path: TString;
  limits: TOptional<typeof ImageLimitsSchema>;
}> = Type.Object(
  { path: PathParam, limits: Type.Optional(ImageLimitsSchema) },
  { additionalProperties: false },
);
export const ResizeImageInput: TObject<{
  blob: typeof ImageBlobRefSchema;
  mimeType: TString;
  limits: typeof ImageLimitsSchema;
}> = Type.Object(
  {
    blob: ImageBlobRefSchema,
    mimeType: Type.String({ maxLength: 127 }),
    limits: ImageLimitsSchema,
  },
  { additionalProperties: false },
);
const ImageSource: TObject<{
  kind: TUnion<[TLiteral<"paste">, TLiteral<"file">, TLiteral<"url">, TLiteral<"tool">]>;
  name: TOptional<TString>;
}> = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("paste"),
      Type.Literal("file"),
      Type.Literal("url"),
      Type.Literal("tool"),
    ]),
    name: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);
export const RegisterImageInput: TObject<{
  data: TString;
  mimeType: TString;
  source: TOptional<typeof ImageSource>;
  limits: TOptional<typeof ImageLimitsSchema>;
}> = Type.Object(
  {
    /** 표준 base64. 길이 상한은 설정 l2.workspace.images.maxInputBytes로 따로 검사한다 */
    data: Type.String({ minLength: 4 }),
    mimeType: Type.String({ pattern: "^image/[a-z0-9.+-]+$", maxLength: 127 }),
    source: Type.Optional(ImageSource),
    limits: Type.Optional(ImageLimitsSchema),
  },
  { additionalProperties: false },
);

const IMAGE_ERRORS = {
  image_unsupported: {
    description: "지원하지 않는 형식이고 변환할 처리기가 없음",
    retryable: false,
  },
  image_too_large: {
    description: "한도 안으로 줄일 수 없음(처리기가 없거나 줄여도 넘음)",
    retryable: false,
  },
  image_decode_failed: { description: "이미지를 해석하지 못함", retryable: false },
} as const;

type ImagesMethods = {
  readonly load: MethodDef<typeof LoadImageInput, typeof WorkspaceImageSchema>;
  readonly resize: MethodDef<typeof ResizeImageInput, typeof WorkspaceImageSchema>;
  readonly register: MethodDef<typeof RegisterImageInput, typeof WorkspaceImageSchema>;
};

/** 도구가 없는 능력이다. 모델은 read로 이미지 파일을 읽고, 첨부는 dialog.attachments가 register를 부른다. */
export const WorkspaceImages: CapabilityDef<ImagesMethods, readonly []> = defineCapability({
  id: "workspace.images",
  version: "1.0.0",
  description: "이미지를 모델이 받을 수 있는 형식과 크기로 맞추고 blob으로 등록한다.",
  service: {
    methods: {
      load: {
        description: "파일에서 이미지를 읽어 준비하고 등록한다.",
        input: LoadImageInput,
        output: WorkspaceImageSchema,
        replay: "safe",
        errors: IMAGE_ERRORS,
      },
      resize: {
        description: "등록된 이미지를 다른 한도로 다시 준비한다.",
        input: ResizeImageInput,
        output: WorkspaceImageSchema,
        replay: "safe",
        errors: IMAGE_ERRORS,
      },
      register: {
        description: "base64 이미지 데이터를 준비하고 등록한다. 붙여넣기 첨부에 쓴다.",
        input: RegisterImageInput,
        output: WorkspaceImageSchema,
        replay: "safe",
        errors: IMAGE_ERRORS,
      },
    },
  },
  tools: [],
});
export const WorkspaceImagesKey: ServiceKey<CapabilityApi<typeof WorkspaceImages>> =
  serviceKey(WorkspaceImages);

// ── 도메인 서비스 (§3.5) ────────────────────────────────────────────────

/** 묶음 이름. eng.context-map.design §5.3 표의 이름이고 Cordis 등록 이름이 아니다 */
export const WorkspaceServiceName = "xeon.workspace" as const;

/** workspace 도메인 묶음 타입(L2.readme §5.6). Cordis에 등록하지 않는다. 등록은 능력마다 cap:<id> 바인딩이다 */
export interface WorkspaceService {
  readonly files: CapabilityApi<typeof WorkspaceFiles>;
  readonly shell: CapabilityApi<typeof WorkspaceShell>;
  readonly images: CapabilityApi<typeof WorkspaceImages>;
}
