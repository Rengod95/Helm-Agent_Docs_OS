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
  type TUnsafe,
} from "typebox";
import { parseJson } from "../../base/index.ts";
import { SandboxBlockSchema, type SandboxBlock } from "../sandbox-block.ts";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolContent, ToolSpec } from "../tool-spec.ts";

/** 모델과 그룹 코드가 넘기는 경로. 상대 경로는 cwd 기준. 앞의 "@"는 지운다(L2.workspace.spec §4.3) */
const PathParam = Type.String({
  minLength: 1,
  maxLength: 4096,
  description: "File path (relative or absolute)",
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
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "First line to read (1-based)" }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100_000,
        description: "Maximum number of lines to read",
      }),
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
        description:
          "Edit list. Each edit is matched against the original file. Merge overlapping edits into one",
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
      description: "Regular expression, or a plain string when literal is true",
    }),
    path: Type.Optional(PathParam),
    glob: Type.Optional(
      Type.String({ maxLength: 512, description: "File filter glob. Example: *.ts" }),
    ),
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
      description: "File glob. Example: **/*.spec.ts",
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
  const total = t.total === undefined ? "" : ` / total ${t.total}`;
  const next = t.nextOffset === undefined ? "" : ` Continue reading: offset=${t.nextOffset}`;
  return `\n\n[Truncated: ${t.by} limit, ${t.shown}${total}.${next}]`;
}

function renderRead(out: Static<typeof ReadOutput>): ToolContent {
  if (out.kind === "image") {
    return {
      content: [
        {
          type: "text",
          text: `${out.path} (${out.image.mimeType}${out.image.resized ? ", resized" : ""})`,
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
    const decoded = parseJson(edits);
    // 모델이 보낸 문자열이 JSON이 아니면 edits가 없는 입력으로 보고 oldText/newText 쌍으로 대체한다
    edits = decoded.ok ? decoded.value : [];
  }
  if (edits !== undefined && !Array.isArray(edits)) edits = [edits];
  const list: Static<typeof Replacement>[] = Array.isArray(edits)
    ? edits.filter(isReplacement)
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
  description:
    "Read, write, edit, list, search contents of, and find files in the working directory.",
  service: {
    methods: {
      read: {
        description:
          "Reads a text file by line range. For an image file, returns an image reference.",
        input: ReadInput,
        output: ReadOutput,
        replay: "safe",
        readOnly: true,
        errors: {
          read_binary: { description: "Binary file that is not an image", retryable: false },
          offset_beyond_end: {
            description: "offset is larger than the number of lines in the file",
            retryable: false,
          },
        },
      },
      write: {
        description:
          "Writes the whole file. Creates it, along with parent directories, if it does not exist.",
        input: WriteInput,
        output: WriteOutput,
        replay: "unsafe",
      },
      edit: {
        description:
          "Replaces several ranges, each located against the original, in one call. Tries exact matching first and falls back to fuzzy matching.",
        input: EditInput,
        output: EditOutput,
        replay: "unsafe",
        errors: {
          edit_not_found: { description: "oldText not found", retryable: false },
          edit_ambiguous: { description: "oldText occurs in two or more places", retryable: false },
          edit_overlap: { description: "Ranges of two edits overlap", retryable: false },
          edit_empty_old_text: { description: "oldText is an empty string", retryable: false },
          edit_no_change: {
            description: "Edit result is the same as the original",
            retryable: false,
          },
          edit_not_text: {
            description: "File contains NUL or is not valid UTF-8. Nothing was written",
            retryable: false,
          },
          edit_conflict: {
            description: "Another write changed the file after it was read. Nothing was written",
            retryable: false,
          },
        },
      },
      list: {
        description: "Returns directory entries sorted by name.",
        input: ListInput,
        output: ListOutput,
        replay: "safe",
        readOnly: true,
      },
      grep: {
        description: "Searches file contents by regular expression or string. Respects .gitignore.",
        input: GrepInput,
        output: GrepOutput,
        replay: "safe",
        readOnly: true,
        errors: {
          pattern_invalid: { description: "Invalid regular expression syntax", retryable: false },
        },
      },
      find: {
        description: "Finds files by glob. Respects .gitignore.",
        input: FindInput,
        output: FindOutput,
        replay: "safe",
        readOnly: true,
        errors: { pattern_invalid: { description: "Invalid glob syntax", retryable: false } },
      },
    },
  },
  tools: [
    {
      name: "read",
      label: "Read File",
      method: "read",
      parameters: ReadInput,
      description:
        "Reads file contents. Large files are cut at the configured line and byte limits, and the offset to continue reading from is reported. Image files are returned as images.",
      toContent: renderRead,
      replay: "safe",
      executionMode: "parallel",
      hints: READ_ONLY,
    },
    {
      name: "write",
      label: "Write File",
      method: "write",
      parameters: WriteInput,
      description:
        "Writes the full content to a file, overwriting any existing file. Use edit for partial changes.",
      toContent: renderChange("Wrote"),
      replay: "unsafe",
      executionMode: "parallel",
      hints: { readOnly: false, destructive: true, idempotent: true },
    },
    {
      name: "edit",
      label: "Edit File",
      method: "edit",
      parameters: EditToolParams,
      toInput: toEditInput,
      description:
        "Replaces specific ranges in a file. oldText must occur in exactly one place in the original. To make several edits at once, send them in the edits array.",
      toContent: renderChange("Edited"),
      replay: "unsafe",
      executionMode: "parallel",
      hints: { readOnly: false, destructive: true, idempotent: false },
    },
    {
      name: "ls",
      label: "List Directory",
      method: "list",
      parameters: ListInput,
      description:
        "Lists directory entries sorted by name. Directories end with /. Includes dot files.",
      toContent: renderList,
      replay: "safe",
      executionMode: "parallel",
      hints: READ_ONLY,
    },
    {
      name: "grep",
      label: "Search Contents",
      method: "grep",
      parameters: GrepInput,
      description:
        "Searches file contents and returns paths and line numbers. Respects .gitignore. Result count and line length are limited.",
      toContent: renderGrep,
      replay: "safe",
      executionMode: "parallel",
      hints: READ_ONLY,
    },
    {
      name: "find",
      label: "Find Files",
      method: "find",
      parameters: FindInput,
      description:
        "Finds files by glob pattern and returns paths relative to the base directory. Respects .gitignore.",
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
    /** 그룹 코드가 시크릿을 명시적으로 넘길 때만 쓴다. 값 주입은 fresnel.exec가 실행 직전에 한다 */
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
  unsandboxedBy: TOptional<
    TUnion<[TLiteral<"escape">, TLiteral<"run_unsandboxed">, TLiteral<"disabled">]>
  >;
  sandboxBlocks: TOptional<TArray<TUnsafe<SandboxBlock>>>;
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
    /** 샌드박스 밖에서 실행한 이유. sandboxed가 거짓일 때만 있다(L0.sandbox.spec §3, L1.tools.spec §4.12 감사 이벤트 tool.sandbox_bypassed의 입력) */
    unsandboxedBy: Type.Optional(
      Type.Union([
        Type.Literal("escape"),
        Type.Literal("run_unsandboxed"),
        Type.Literal("disabled"),
      ]),
    ),
    /** 샌드박스가 막은 것(L0.sandbox.spec §4.2 11번). 막은 것이 없으면 키가 없다. 실패한 실행에도 싣는다 */
    sandboxBlocks: Type.Optional(Type.Array(SandboxBlockSchema, { maxItems: 256 })),
  },
  { additionalProperties: false },
);

export const BashToolParams: TObject<{ command: TString; timeout: TOptional<TNumber> }> =
  Type.Object(
    {
      command: Type.String({
        minLength: 1,
        maxLength: 131_072,
        description: "bash command to run",
      }),
      timeout: Type.Optional(
        Type.Number({ exclusiveMinimum: 0, maximum: 86_400, description: "Timeout (seconds)" }),
      ),
    },
    { additionalProperties: false },
  );

function renderRun(out: Static<typeof RunOutput>): ToolContent {
  const head = out.truncated
    ? `[Leading output omitted${out.fullOutputPath ? `, full output: ${out.fullOutputPath}` : ""}]\n`
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
  description:
    "Runs shell commands in the working directory. If the sandbox is on, commands run inside it.",
  service: {
    methods: {
      run: {
        description: "Runs a bash command and returns its exit code and the tail of its output.",
        input: RunInput,
        output: RunOutput,
        replay: "unsafe",
        errors: {
          exit_nonzero: {
            description:
              "failOnNonZero is true and the exit code is not 0. Puts RunOutput in detail",
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
      label: "Shell Command",
      method: "run",
      parameters: BashToolParams,
      toInput: (p) => ({
        command: p.command,
        failOnNonZero: true,
        ...(p.timeout === undefined ? {} : { timeoutSec: p.timeout }),
      }),
      description:
        "Runs a bash command in the current working directory and returns stdout and stderr combined. If the output exceeds the limit, only the last part is kept and the full output goes to a temporary file. A timeout in seconds can be set.",
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
    description: "Unsupported format and no converter available",
    retryable: false,
  },
  image_too_large: {
    description:
      "Cannot be reduced within the limit (no converter, or still over the limit after reducing)",
    retryable: false,
  },
  image_decode_failed: { description: "Could not decode the image", retryable: false },
} as const;

type ImagesMethods = {
  readonly load: MethodDef<typeof LoadImageInput, typeof WorkspaceImageSchema>;
  readonly resize: MethodDef<typeof ResizeImageInput, typeof WorkspaceImageSchema>;
  readonly register: MethodDef<typeof RegisterImageInput, typeof WorkspaceImageSchema>;
};

/** 도구가 없는 기능이다. 모델은 read로 이미지 파일을 읽고, 첨부는 dialog.attachments가 register를 부른다. */
export const WorkspaceImages: CapabilityDef<ImagesMethods, readonly []> = defineCapability({
  id: "workspace.images",
  version: "1.0.0",
  description: "Fits an image to a format and size the model accepts, and registers it as a blob.",
  service: {
    methods: {
      load: {
        description: "Reads an image from a file, prepares it, and registers it.",
        input: LoadImageInput,
        output: WorkspaceImageSchema,
        replay: "safe",
        readOnly: true,
        errors: IMAGE_ERRORS,
      },
      resize: {
        description: "Prepares a registered image again with different limits.",
        input: ResizeImageInput,
        output: WorkspaceImageSchema,
        replay: "safe",
        readOnly: true,
        errors: IMAGE_ERRORS,
      },
      register: {
        description: "Prepares and registers base64 image data. Used for pasted attachments.",
        input: RegisterImageInput,
        output: WorkspaceImageSchema,
        replay: "unsafe",
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
export const WorkspaceServiceName = "fresnel.workspace" as const;

/** workspace 도메인 묶음 타입(L2.readme §5.6). Cordis에 등록하지 않는다. 등록은 기능마다 cap:<id> 바인딩이다 */
export interface WorkspaceService {
  readonly files: CapabilityApi<typeof WorkspaceFiles>;
  readonly shell: CapabilityApi<typeof WorkspaceShell>;
  readonly images: CapabilityApi<typeof WorkspaceImages>;
}
