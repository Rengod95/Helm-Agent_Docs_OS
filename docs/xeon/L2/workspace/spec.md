---
id: L2.workspace.spec
layer: L2
domain: workspace
kind: spec
status: draft
depends_on: [F.capabilities.spec, F.conversation.spec, L0.exec.spec, L0.sandbox.spec, L1.tools.spec, eng.context-map.design]
binds: [xeon/packages/cap-workspace/**]
---

# L2 작업 도구 (workspace)

패키지: `@xeon/cap-workspace` (`xeon/packages/cap-workspace`). 서비스: `xeon.workspace`. 계획 v2 하위 층: L2-a "작업 도구".

## 1. 목적과 범위

### 1.1 정하는 것

- 파일·셸 도구셋 7종: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`(`_research/layer-plan-v2.json` L2-a "파일·셸 도구셋").
- 위 도구가 환원되는 능력 3개의 정의: `workspace.files`, `workspace.shell`, `workspace.images`. 정의 데이터는 F `capabilities/defs/workspace.ts`에 들어간다(`L2.readme` §5.1).
- 편집 방식: 정확 일치, 퍼지 일치, `edits` 배열, 실패 코드. 줄 해시 편집은 2차 설계 메모만 둔다.
- 이미지와 첨부 처리: 이미지 읽기, 크기 맞춤, blob 등록, 모델에 참조로 전달.
- 출력 절단: 한도, 이어 읽기 정보, 절단 코드의 위치.
- 경로 해석과 탈출 검사, 실행 기반(`xeon.exec`, `xeon.sandbox`)과의 경계.
- 설정 키 `l2.workspace.*`.

### 1.2 다루지 않는 것

| 대상 | 정하는 곳 |
|---|---|
| `ExecutionEnv` 인터페이스와 구현(pi durable env 포크), 출력 spill, 프로세스 그룹 종료 | `L0.exec.spec` |
| OS 샌드박스 정책, 쓰기 허용 경로의 커널 수준 강제, 보호 경로 목록 | `L0.sandbox.spec` |
| 권한 모드, 권한 규칙, 승인 프로토콜, 도구 실행 파이프라인, 결과 경계화 | `L1.tools.spec` |
| 되감기와 파일 복원, 체크포인트 | `L1.persistence.spec` |
| 비밀 주입과 출력 마스킹 | `L0.secrets.spec`, `L1.tools.spec` |
| blob 저장 구현(`sys_blobs`, 파일 배치) | `L0.store.spec` |
| 첨부 입력 경로(붙여넣기, URL 첨부, 사용자 입력과의 결합) | `L2.dialog.spec` |
| 변경 리뷰(hunk 승인, 코멘트) | `L2.artifacts.spec` |

AST·LSP [결정: 보류]: 구문 트리 검색·편집(omp `crates/pi-ast`)과 언어 서버 진단(vscode-jsonrpc 9.0.3)은 계획 v2에서 보류다(`_research/layer-plan-v2.json` L2-a "AST·LSP", `_research/packages.md` §4.4 L2-a 4행). 대규모 리팩터링 비중이 커지면 다시 다룬다. 다시 다룰 때는 이 도메인에 새 능력(`workspace.code` 같은 id)을 더하는 방식을 [제안]하고, 기존 세 능력의 정의는 바꾸지 않는다. 언어 서버는 장수 자식 프로세스라 상주 수준 1(`L2.readme` §8)이 되고 `xeon.process`를 쓴다.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 작업 디렉터리 (cwd) | 세션의 현재 디렉터리. 상대 경로의 기준이다. `ExecutionEnv`가 들고 있다(`L0.exec.spec`) |
| 허용 root | 파일 도구가 접근할 수 있는 디렉터리 목록. 읽기용과 쓰기용이 따로 있다. 값은 L1.tools 권한 정책에서 온다(§4.3) |
| 정규 경로 | 심볼릭 링크와 `.`, `..`를 모두 푼 절대 경로. `ExecutionEnv.canonicalPath`의 결과 |
| 경로 탈출 | 요청 경로의 정규 경로가 허용 root 밖에 있는 경우. `..` 조합과 심볼릭 링크 둘 다 해당한다 |
| 정확 일치 | `oldText`를 줄 끝만 LF로 맞춘 본문에서 그대로 찾는 것 |
| 퍼지 일치 | 본문과 `oldText`를 같은 규칙(§4.4 표)으로 정규화한 뒤 찾는 것 |
| 절단 | 출력이 줄 수나 바이트 한도를 넘을 때 앞쪽(읽기) 또는 뒤쪽(셸) 일부만 남기는 것 |
| 이미지 참조 | blob 저장소에 둔 이미지의 `BlobRef` 모양 값. 모델 요청 직전에 실제 데이터로 바뀐다(§4.6) |

## 3. 인터페이스

### 3.1 공통 스키마

아래 코드는 모두 `xeon/packages/contracts/src/capabilities/defs/workspace.ts`에 들어간다. `F.capabilities.spec` §3.9 예시처럼 읽기 쉽도록 export 상수의 타입 주석을 생략했다. 실제 파일은 `isolatedDeclarations` 때문에 export 상수마다 명시 타입 주석을 단다(`F.capabilities.spec` §3.9 첫 단락 뒤 설명).

```ts
// xeon/packages/contracts/src/capabilities/defs/workspace.ts
import { Type, type Static } from "typebox";
import { defineCapability, serviceKey, type ToolContent } from "../index.ts";

/** 모델과 그룹 코드가 넘기는 경로. 상대 경로는 cwd 기준. 앞의 "@"는 지운다(§4.3) */
const PathParam = Type.String({ minLength: 1, maxLength: 4096, description: "파일 경로(상대 또는 절대)" });

/** 절단 정보. 절단이 없으면 필드 자체를 두지 않는다 */
export const TruncationInfoSchema = Type.Object({
  /** 어느 한도에 걸렸는가. entries는 grep·find·ls의 개수 한도 */
  by: Type.Union([Type.Literal("lines"), Type.Literal("bytes"), Type.Literal("entries")]),
  /** 결과에 담은 단위 수(줄 또는 항목) */
  shown: Type.Integer({ minimum: 0 }),
  /** 전체 단위 수. 끝까지 세지 않는 도구(grep, find)는 알 수 없을 때 생략한다 */
  total: Type.Optional(Type.Integer({ minimum: 0 })),
  /** read 전용. 이어 읽을 때 넘길 offset(1부터) */
  nextOffset: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type TruncationInfo = Static<typeof TruncationInfoSchema>;

/**
 * F.records.spec §3.4 BlobRef와 같은 모양. capabilities는 records를 import하지 않으므로(F.readme §3 순서 표)
 * 같은 모양을 여기 적는다. 두 스키마의 일치는 테스트로 확인한다(§10 미결 3).
 */
export const ImageBlobRefSchema = Type.Object({
  type: Type.Literal("blob"),
  sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  size: Type.Integer({ minimum: 0 }),
  mediaType: Type.Union([Type.String(), Type.Null()]),
});

const PixelSize = Type.Object({ width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) });

export const ImageLimitsSchema = Type.Object({
  maxWidth: Type.Integer({ minimum: 1, maximum: 16384 }),
  maxHeight: Type.Integer({ minimum: 1, maximum: 16384 }),
  /** base64 길이 기준 바이트 */
  maxBytes: Type.Integer({ minimum: 1024 }),
});
export type ImageLimits = Static<typeof ImageLimitsSchema>;

/** 모델에 넘길 수 있게 준비된 이미지 */
export const WorkspaceImageSchema = Type.Object({
  blob: ImageBlobRefSchema,
  /** image/png, image/jpeg, image/gif, image/webp 중 하나 */
  mimeType: Type.String(),
  /** 처리기가 없으면 알 수 없다 */
  size: Type.Optional(PixelSize),
  resized: Type.Optional(Type.Object({ from: PixelSize, to: PixelSize })),
  /** 원래 형식이 mimeType과 다를 때. 예: image/bmp → image/png */
  convertedFrom: Type.Optional(Type.String()),
});
export type WorkspaceImage = Static<typeof WorkspaceImageSchema>;

/** 쓰기·편집 결과의 변경 기록. artifacts.reviews와 UI가 읽는다 */
export const FileChangeSchema = Type.Object({
  /** 정규 경로 */
  path: Type.String(),
  /** 쓰기 전 파일이 있었는가 */
  existed: Type.Boolean(),
  /** unified diff. 파일 이름 줄은 a/<상대 경로>, b/<상대 경로> */
  diff: Type.String(),
  added: Type.Integer({ minimum: 0 }),
  removed: Type.Integer({ minimum: 0 }),
  /** 처음 바뀐 줄(1부터). 바뀐 줄이 없으면 생략 */
  firstChangedLine: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type FileChange = Static<typeof FileChangeSchema>;
```

### 3.2 `workspace.files`

```ts
// ---- read
export const ReadInput = Type.Object({
  path: PathParam,
  offset: Type.Optional(Type.Integer({ minimum: 1, description: "읽기 시작 줄(1부터)" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000, description: "읽을 최대 줄 수" })),
});
export const ReadOutput = Type.Union([
  Type.Object({
    kind: Type.Literal("text"),
    path: Type.String(),
    text: Type.String(),
    startLine: Type.Integer({ minimum: 1 }),
    endLine: Type.Integer({ minimum: 0 }),
    totalLines: Type.Integer({ minimum: 0 }),
    truncated: Type.Optional(TruncationInfoSchema),
  }),
  Type.Object({ kind: Type.Literal("image"), path: Type.String(), image: WorkspaceImageSchema }),
]);

// ---- write
export const WriteInput = Type.Object({
  path: PathParam,
  content: Type.String({ description: "파일에 쓸 전체 내용" }),
});
export const WriteOutput = Type.Object({ bytes: Type.Integer({ minimum: 0 }), change: FileChangeSchema });

// ---- edit
const Replacement = Type.Object({
  oldText: Type.String({ description: "바꿀 원문. 원본 파일에서 한 곳에만 있어야 하고 다른 편집과 겹치면 안 된다" }),
  newText: Type.String({ description: "바꿀 내용" }),
});
export const EditInput = Type.Object({
  path: PathParam,
  edits: Type.Array(Replacement, { minItems: 1, maxItems: 64 }),
});
/** 모델 도구 파라미터. 모델이 자주 보내는 변형(문자열로 된 edits, 단일 객체, 최상위 oldText/newText)을 받는다 */
export const EditToolParams = Type.Object({
  path: PathParam,
  edits: Type.Optional(Type.Union([Type.Array(Replacement), Replacement, Type.String()], {
    description: "편집 목록. 각 편집은 원본 파일 기준으로 찾는다. 겹치는 편집은 하나로 합친다",
  })),
  oldText: Type.Optional(Type.String()),
  newText: Type.Optional(Type.String()),
});
export const EditOutput = Type.Object({
  applied: Type.Integer({ minimum: 1 }),
  matchMode: Type.Union([Type.Literal("exact"), Type.Literal("fuzzy")]),
  change: FileChangeSchema,
});

// ---- list (도구 이름 ls)
export const ListInput = Type.Object({
  path: Type.Optional(PathParam),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
});
export const ListOutput = Type.Object({
  path: Type.String(),
  /** 이름 바이트 순. 점 파일 포함 */
  entries: Type.Array(Type.Object({
    name: Type.String(),
    kind: Type.Union([Type.Literal("file"), Type.Literal("directory"), Type.Literal("symlink")]),
  })),
  truncated: Type.Optional(TruncationInfoSchema),
});

// ---- grep
export const GrepInput = Type.Object({
  pattern: Type.String({ minLength: 1, maxLength: 4096, description: "정규식 또는 literal이 참이면 문자열" }),
  path: Type.Optional(PathParam),
  glob: Type.Optional(Type.String({ maxLength: 512, description: "파일 거르기 glob. 예: *.ts" })),
  ignoreCase: Type.Optional(Type.Boolean()),
  literal: Type.Optional(Type.Boolean()),
  context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
});
export const GrepOutput = Type.Object({
  /** 검색 기준 디렉터리(정규 경로). matches의 path는 이 기준 상대 경로 */
  root: Type.String(),
  matches: Type.Array(Type.Object({
    path: Type.String(),
    line: Type.Integer({ minimum: 1 }),
    text: Type.String(),
    kind: Type.Union([Type.Literal("match"), Type.Literal("context")]),
  })),
  truncated: Type.Optional(TruncationInfoSchema),
});

// ---- find
export const FindInput = Type.Object({
  pattern: Type.String({ minLength: 1, maxLength: 512, description: "파일 glob. 예: **/*.spec.ts" }),
  path: Type.Optional(PathParam),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
});
export const FindOutput = Type.Object({
  root: Type.String(),
  /** root 기준 상대 경로, 바이트 순 */
  paths: Type.Array(Type.String()),
  truncated: Type.Optional(TruncationInfoSchema),
});

// ---- 렌더링(순수 함수)
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
        { type: "text", text: `${out.path} (${out.image.mimeType}${out.image.resized ? ", 크기 조정됨" : ""})` },
        // data는 자리표시 문자열이다. L1.context가 요청 직전에 blob 내용으로 바꾼다(§4.6)
        { type: "image", data: `blob:sha256:${out.image.blob.sha256}`, mimeType: out.image.mimeType },
      ],
      structuredContent: out,
    };
  }
  return { content: [{ type: "text", text: out.text + truncNote(out.truncated) }], structuredContent: out };
}

function renderChange(verb: string) {
  return (out: { change: FileChange }): ToolContent => ({
    content: [{ type: "text", text: `${verb}: ${out.change.path} (+${out.change.added} -${out.change.removed})` }],
    structuredContent: out,
    details: out.change,
  });
}

function renderList(out: Static<typeof ListOutput>): ToolContent {
  const lines = out.entries.map((e) => (e.kind === "directory" ? `${e.name}/` : e.name));
  return { content: [{ type: "text", text: lines.join("\n") + truncNote(out.truncated) }], structuredContent: out };
}

function renderGrep(out: Static<typeof GrepOutput>): ToolContent {
  const lines = out.matches.map((m) => `${m.path}${m.kind === "match" ? ":" : "-"}${m.line}${m.kind === "match" ? ":" : "-"} ${m.text}`);
  return { content: [{ type: "text", text: lines.join("\n") + truncNote(out.truncated) }], structuredContent: out };
}

function renderFind(out: Static<typeof FindOutput>): ToolContent {
  return { content: [{ type: "text", text: out.paths.join("\n") + truncNote(out.truncated) }], structuredContent: out };
}

/** EditToolParams → EditInput. 순수 함수. durable tools/edit.ts prepareEditArguments의 규칙을 옮긴다 */
function toEditInput(p: Static<typeof EditToolParams>): Static<typeof EditInput> {
  let edits: unknown = p.edits;
  if (typeof edits === "string") {
    try { edits = JSON.parse(edits); } catch { edits = []; }
  }
  if (edits !== undefined && !Array.isArray(edits)) edits = [edits];
  const list = (edits ?? []) as { oldText: string; newText: string }[];
  if (list.length === 0 && typeof p.oldText === "string" && typeof p.newText === "string") {
    return { path: p.path, edits: [{ oldText: p.oldText, newText: p.newText }] };
  }
  return { path: p.path, edits: list };
}

const READ_ONLY = { readOnly: true, idempotent: true } as const;

export const WorkspaceFiles = defineCapability({
  id: "workspace.files",
  version: "1.0.0",
  description: "작업 디렉터리의 파일 읽기, 쓰기, 편집, 목록, 내용 검색, 파일 찾기.",
  service: {
    methods: {
      read: {
        description: "텍스트 파일을 줄 범위로 읽는다. 이미지 파일이면 이미지 참조를 돌려준다.",
        input: ReadInput, output: ReadOutput, replay: "safe", readOnly: true,
        errors: {
          read_binary: { description: "이미지가 아닌 바이너리 파일", retryable: false },
          offset_beyond_end: { description: "offset이 파일 줄 수보다 큼", retryable: false },
        },
      },
      write: {
        description: "파일 전체를 쓴다. 없으면 만들고 부모 디렉터리도 만든다.",
        input: WriteInput, output: WriteOutput, replay: "unsafe",
      },
      edit: {
        description: "원본 기준으로 찾은 구간들을 한 번에 바꾼다. 정확 일치를 먼저 쓰고 실패하면 퍼지 일치를 쓴다.",
        input: EditInput, output: EditOutput, replay: "unsafe",
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
        input: ListInput, output: ListOutput, replay: "safe", readOnly: true,
      },
      grep: {
        description: "파일 내용을 정규식이나 문자열로 검색한다. .gitignore를 따른다.",
        input: GrepInput, output: GrepOutput, replay: "safe", readOnly: true,
        errors: { pattern_invalid: { description: "정규식 문법 오류", retryable: false } },
      },
      find: {
        description: "glob으로 파일을 찾는다. .gitignore를 따른다.",
        input: FindInput, output: FindOutput, replay: "safe", readOnly: true,
        errors: { pattern_invalid: { description: "glob 문법 오류", retryable: false } },
      },
    },
  },
  tools: [
    {
      name: "read", label: "파일 읽기", method: "read", parameters: ReadInput,
      description: "파일 내용을 읽는다. 큰 파일은 설정된 줄·바이트 한도에서 잘리고 이어 읽을 offset을 알려 준다. 이미지 파일은 이미지로 돌려준다.",
      toContent: renderRead, replay: "safe", executionMode: "parallel", hints: READ_ONLY,
    },
    {
      name: "write", label: "파일 쓰기", method: "write", parameters: WriteInput,
      description: "파일에 내용을 통째로 쓴다. 기존 파일은 덮어쓴다. 부분 수정은 edit를 쓴다.",
      toContent: renderChange("썼음"), replay: "unsafe", executionMode: "parallel",
      hints: { readOnly: false, destructive: true, idempotent: true },
    },
    {
      name: "edit", label: "파일 편집", method: "edit", parameters: EditToolParams, toInput: toEditInput,
      description: "파일의 특정 구간을 바꾼다. oldText는 원본에서 한 곳에만 있어야 한다. 여러 편집은 edits 배열로 한 번에 보낸다.",
      toContent: renderChange("편집함"), replay: "unsafe", executionMode: "parallel",
      hints: { readOnly: false, destructive: true, idempotent: false },
    },
    {
      name: "ls", label: "디렉터리 목록", method: "list", parameters: ListInput,
      description: "디렉터리 항목을 이름 순으로 보여 준다. 디렉터리는 끝에 /를 붙인다. 점 파일을 포함한다.",
      toContent: renderList, replay: "safe", executionMode: "parallel", hints: READ_ONLY,
    },
    {
      name: "grep", label: "내용 검색", method: "grep", parameters: GrepInput,
      description: "파일 내용을 검색해 경로와 줄 번호를 돌려준다. .gitignore를 따른다. 결과 수와 줄 길이에 한도가 있다.",
      toContent: renderGrep, replay: "safe", executionMode: "parallel", hints: READ_ONLY,
    },
    {
      name: "find", label: "파일 찾기", method: "find", parameters: FindInput,
      description: "glob 패턴으로 파일을 찾아 기준 디렉터리 상대 경로를 돌려준다. .gitignore를 따른다.",
      toContent: renderFind, replay: "safe", executionMode: "parallel", hints: READ_ONLY,
    },
  ],
});
export const WorkspaceFilesKey = serviceKey(WorkspaceFiles);
```

- 기계 이름은 pi 이름 그대로다(`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`). `ls` 도구의 메서드 이름은 `list`다. 메서드 이름 규칙(`^[a-z][a-zA-Z0-9]{0,47}$`)에는 `ls`도 맞지만 서비스 API에서 뜻이 드러나는 이름을 쓴다 [제안].
- `read`, `write`, `ls`, `grep`, `find`는 `toInput`이 없으므로 `parameters`와 메서드 `input`이 같은 스키마 상수다(`tool_input_mismatch` 없음). `edit`만 `toInput`을 둔다.
- `edit`의 `toInput`은 `JSON.parse`를 쓰지만 입력만 보고 결과를 내므로 순수 함수다. 정규화 뒤 `edits`가 비면 메서드 입력 검사(`minItems: 1`)에서 `invalid_input`이 난다.
- 메서드 `replay`와 도구 `replay`가 같다. 도구가 메서드보다 넓지 않으므로 `replay_widened`가 나지 않는다(`F.capabilities.spec` §4.2).

### 3.3 `workspace.shell`

```ts
const EnvName = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$" });
const SecretRefParam = Type.String({ pattern: "^secret://[a-z][a-z0-9-]{1,63}$" });   // F.wire-settings.spec §3.8.1 SecretRef와 같은 형식

export const RunInput = Type.Object({
  command: Type.String({ minLength: 1, maxLength: 131072 }),
  /** 초. 생략하면 설정 l2.workspace.shell.defaultTimeoutSec(0이면 제한 없음) */
  timeoutSec: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 86400 })),
  /** 생략하면 세션 cwd. 허용 root 안이어야 한다 */
  cwd: Type.Optional(PathParam),
  /** 참이면 0이 아닌 종료 코드를 exit_nonzero 오류로 낸다. 모델 도구는 항상 참이다 */
  failOnNonZero: Type.Optional(Type.Boolean()),
  /** 그룹 코드가 비밀을 명시적으로 넘길 때만 쓴다. 값 주입은 xeon.exec가 실행 직전에 한다 */
  secretEnv: Type.Optional(Type.Record(EnvName, SecretRefParam)),
});
export const RunOutput = Type.Object({
  exitCode: Type.Integer(),
  /** stdout과 stderr를 합친 출력의 남긴 꼬리 */
  output: Type.String(),
  truncated: Type.Boolean(),
  /** 한도를 넘어 파일로 넘긴 전체 출력의 경로 */
  fullOutputPath: Type.Optional(Type.String()),
  durationMs: Type.Integer({ minimum: 0 }),
  /** 샌드박스 안에서 실행했는가 */
  sandboxed: Type.Boolean(),
});

export const BashToolParams = Type.Object({
  command: Type.String({ minLength: 1, description: "실행할 bash 명령" }),
  timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 86400, description: "제한 시간(초)" })),
});

function renderRun(out: Static<typeof RunOutput>): ToolContent {
  const head = out.truncated ? `[앞부분 생략${out.fullOutputPath ? `, 전체 출력: ${out.fullOutputPath}` : ""}]\n` : "";
  return { content: [{ type: "text", text: head + out.output }], structuredContent: out };
}

export const WorkspaceShell = defineCapability({
  id: "workspace.shell",
  version: "1.0.0",
  description: "작업 디렉터리에서 셸 명령을 실행한다. 샌드박스가 켜져 있으면 그 안에서 실행한다.",
  service: {
    methods: {
      run: {
        description: "bash 명령을 실행하고 종료 코드와 출력 꼬리를 돌려준다.",
        input: RunInput, output: RunOutput, replay: "unsafe",
        errors: {
          exit_nonzero: {
            description: "failOnNonZero가 참이고 종료 코드가 0이 아님. detail에 RunOutput을 싣는다",
            retryable: false, detail: RunOutput,
          },
        },
      },
    },
  },
  tools: [
    {
      name: "bash", label: "셸 명령", method: "run", parameters: BashToolParams,
      toInput: (p) => ({ command: p.command, failOnNonZero: true, ...(p.timeout === undefined ? {} : { timeoutSec: p.timeout }) }),
      description: "현재 작업 디렉터리에서 bash 명령을 실행한다. stdout과 stderr를 합쳐 돌려준다. 출력이 한도를 넘으면 마지막 부분만 남기고 전체는 임시 파일에 둔다. 제한 시간을 초로 줄 수 있다.",
      toContent: renderRun, replay: "unsafe", executionMode: "sequential",
      hints: { readOnly: false, destructive: true, idempotent: false, openWorld: true },
    },
  ],
});
export const WorkspaceShellKey = serviceKey(WorkspaceShell);
```

- 모델 도구의 0 아닌 종료 코드: pi durable `bash`는 0이 아닌 종료를 출력이 담긴 오류 결과로 낸다(`packages/durable/src/tools/bash.ts` `runCommand`). [제안] 같은 동작을 F 환원 규칙 안에서 내기 위해 도구 `toInput`이 `failOnNonZero: true`를 넣고, 메서드가 `exit_nonzero` `CapabilityError`를 낸다. `message`는 `"exit code <n>\n<출력 꼬리>"`이고 `detail`은 `RunOutput`이다. 그래서 모델은 `isError: true` 결과에서 출력을 그대로 본다. 그룹 코드는 `failOnNonZero`를 생략하고 `exitCode`를 직접 읽는다.
- `secretEnv`는 모델 도구 파라미터에 없다. M1의 비밀 참조 검증(`product.scope.spec` §4.4 M1)은 `env` 주입 모드(bash 도구, 실행마다 승인)로 `xeon.exec`와 `xeon.secrets`가 처리한다 [결정: review.decisions-2 U-19]. 비밀 메타 타입(`SecretMeta`, `SecretUsePolicy`, `SecretAuditRecord`)과 `SECRET_REF_PATTERN`의 정본은 F `capabilities/secrets.ts`다(U-08). 출력 마스킹은 저장 전에 L0.secrets·L1.tools가 한다.
- `bash`를 `sequential`로 둔 이유 [제안]: 명령의 부수 효과 순서를 모델이 적은 순서와 같게 한다. core-loop(pi-agent-core 1.3.0 배치 규칙을 옮긴 `loop/tool-batch.ts`, adr.0009)는 한 배치에 `sequential` 도구가 하나라도 있으면 그 배치를 순차로 돈다(`_research/refs/pi-durable.md` 도구 라운드 병렬/순차). `write`, `edit`는 `parallel`로 두고 같은 경로의 변경은 포크한 `file-mutation-queue.ts`가 경로별로 줄 세운다.

### 3.4 `workspace.images`

```ts
export const LoadImageInput = Type.Object({ path: PathParam, limits: Type.Optional(ImageLimitsSchema) });
export const ResizeImageInput = Type.Object({ blob: ImageBlobRefSchema, mimeType: Type.String(), limits: ImageLimitsSchema });
export const RegisterImageInput = Type.Object({
  /** 표준 base64. 길이 상한은 설정 l2.workspace.images.maxInputBytes로 따로 검사한다 */
  data: Type.String({ minLength: 4 }),
  mimeType: Type.String({ pattern: "^image/[a-z0-9.+-]+$" }),
  source: Type.Optional(Type.Object({
    kind: Type.Union([Type.Literal("paste"), Type.Literal("file"), Type.Literal("url"), Type.Literal("tool")]),
    name: Type.Optional(Type.String({ maxLength: 512 })),
  })),
  limits: Type.Optional(ImageLimitsSchema),
});

const IMAGE_ERRORS = {
  image_unsupported: { description: "지원하지 않는 형식이고 변환할 처리기가 없음", retryable: false },
  image_too_large: { description: "한도 안으로 줄일 수 없음(처리기가 없거나 줄여도 넘음)", retryable: false },
  image_decode_failed: { description: "이미지를 해석하지 못함", retryable: false },
} as const;

export const WorkspaceImages = defineCapability({
  id: "workspace.images",
  version: "1.0.0",
  description: "이미지를 모델이 받을 수 있는 형식과 크기로 맞추고 blob으로 등록한다.",
  service: {
    methods: {
      load: { description: "파일에서 이미지를 읽어 준비하고 등록한다.", input: LoadImageInput, output: WorkspaceImageSchema, replay: "safe", readOnly: true, errors: IMAGE_ERRORS },
      resize: { description: "등록된 이미지를 다른 한도로 다시 준비한다.", input: ResizeImageInput, output: WorkspaceImageSchema, replay: "safe", readOnly: true, errors: IMAGE_ERRORS },
      register: { description: "base64 이미지 데이터를 준비하고 등록한다. 붙여넣기 첨부에 쓴다.", input: RegisterImageInput, output: WorkspaceImageSchema, replay: "unsafe", errors: IMAGE_ERRORS },
    },
  },
  tools: [],
});
export const WorkspaceImagesKey = serviceKey(WorkspaceImages);
```

- 도구가 없는 능력이다. 모델은 `read`로 이미지 파일을 읽고, 첨부는 `dialog.attachments`가 `register`를 부른다. 도구 없는 능력의 허용은 `F.capabilities.spec` §4.4 [미결]이다(§10 미결 5).
- `load`와 `resize`는 `readOnly`다. 파일이나 이미 등록된 blob에서 같은 바이트의 사본을 만들 뿐이고 원본은 남는다. `register`는 붙여넣은 데이터가 유일한 사본인 blob을 저장하므로 읽기가 아니고, `requestId`를 기억하지 않아 선언 없음(`replay: "unsafe"`)이다 [결정: M3-REQ-88, 분류 표는 §3.7이다.

### 3.5 도메인 서비스

```ts
// xeon/packages/contracts/src/capabilities/defs/workspace.ts (계속)
import type { CapabilityApi } from "../index.ts";

/** 묶음 이름. eng.context-map.design §5.3 표의 이름이고 Cordis 등록 이름이 아니다 */
export const WorkspaceServiceName = "xeon.workspace" as const;
/** workspace 도메인 묶음 타입(L2.readme §5.6). Cordis에 등록하지 않는다. 등록은 능력마다 cap:<id> 바인딩이다 */
export interface WorkspaceService {
  readonly files: CapabilityApi<typeof WorkspaceFiles>;
  readonly shell: CapabilityApi<typeof WorkspaceShell>;
  readonly images: CapabilityApi<typeof WorkspaceImages>;
}
```

- `L2.readme` §5.6의 대응 규칙을 따른다. consumer는 `WorkspaceFilesKey` 등 능력 단위 키로 API를 얻는다.
- provider는 `cap-workspace` 하나다. provider 선택 체인(`L2.readme` §5.2)과 `l2.workspace.<능력>.provider` 키를 두지 않는다.

### 3.6 이벤트와 레코드

- 이벤트 접두사 `workspace.`는 예약만 한다. 이 문서는 이벤트 type을 정의하지 않는다. 도구 호출 기록은 L1.tools의 `tool.*` 이벤트다(`eng.context-map.design` §5.1).
- 테이블 접두사 `cap_workspace_`도 예약만 한다. 테이블을 만들지 않는다.
- 파일 변경 기록은 도구 결과에 싣는다. `write`, `edit`의 `toContent`는 `details`에 `FileChange`를 넣고, `structuredContent`에도 같은 값이 있다. `L2.artifacts.spec`의 리뷰는 이 `details`를 근거로 한다.

### 3.7 효과 분류 [결정: M3-REQ-88]

ADR-0015 §3.3의 표지로 메서드를 나눈다. `readOnly`는 대화 기록, 사용자 파일과 사용자가 쓴 데이터, 외부 시스템의 상태를 바꾸지 않는 읽기다. 관찰상 순수한 파생 데이터(캐시, 색인, 내용 주소 blob, 사용량·비용 계량, 시간과 현재 데이터만으로 정해지는 정리)는 쓸 수 있다 [결정: 2026-10-28 오케스트레이터, ADR-0015 §3.3]. `idempotent`는 `requestId`를 받아 같은 키의 재호출에 효과를 더하지 않고 처음 결과를 돌려주는 쓰기이며, 기억은 효과와 같은 커밋에 둔다. 둘 다 없으면 선언 없음이고 `replay`는 `"unsafe"`다. 재실행되는 코드(on 핸들러, drive)에서는 `idempotent`와 `readOnly`(drive만)만 부를 수 있다. 정의는 F `defs/` 파일이 정본이고 `contracts/test/capabilities/l2-effect-classes.test.ts`가 이 표와 같은 값을 고정한다.

| 메서드 | 분류 | replay | 근거 |
|---|---|---|---|
| `workspace.files.read` | readOnly | safe | 파일 조회. 이미지 읽기가 만드는 blob은 같은 바이트의 사본이다 |
| `workspace.files.write` | 선언 없음 | unsafe | 파일을 쓴다(spec §3.2. 같은 내용이어도 중간에 다른 쓰기가 끼일 수 있다) |
| `workspace.files.edit` | 선언 없음 | unsafe | 파일을 바꾼다 |
| `workspace.files.list` | readOnly | safe | 디렉터리 조회 |
| `workspace.files.grep` | readOnly | safe | 파일 조회 |
| `workspace.files.find` | readOnly | safe | 파일 조회 |
| `workspace.images.load` | readOnly | safe | 파일을 읽어 같은 바이트의 blob 사본을 만든다. 원본이 남아 있다 |
| `workspace.images.resize` | readOnly | safe | 등록된 blob에서 다시 만든다. 공급자는 2차 |
| `workspace.images.register` | 선언 없음 | unsafe | 붙여넣은 데이터가 유일한 사본인 blob을 저장한다. `requestId` 멱등이 없다 |
| `workspace.shell.run` | 선언 없음 | unsafe | 외부 명령을 실행한다 |

## 4. 동작 규칙

### 4.1 실행 기반

- 모든 파일·셸 접근은 `xeon.exec`가 주는 `ExecutionEnv`(`L0.exec.spec`) 위에서 한다. `cap-workspace`는 `node:fs`, `Bun.file`, `Bun.spawn`을 직접 쓰지 않는다. OS 분기는 L0 구현에만 있다(`eng.dependency-rules.guide` DR-13).
- `ExecutionEnv`는 pi durable `env/index.ts`의 `FileSystem`(`absolutePath`, `canonicalPath`, `exists`, `readTextLines`, `readBinaryFile`, `writeFile`, `listDir`, `createDir` 등)과 `Shell`(`exec`) 합이다. 메서드 이름과 인자는 포크 그대로라고 [가정]하고, 확정은 `L0.exec.spec`을 따른다.
- 취소: 서비스 호출의 `CallOptions.signal`을 `CancelScope { abortSignal }`로 감싸 넘긴다(ADR-0003 §3.1). 취소되면 `aborted` 오류다.
- `ExecutionEnv` 오류 코드의 대응 [제안]:

| `FileErrorCode` / `ExecutionErrorCode` | `CapabilityError.code` |
|---|---|
| `aborted` | `aborted` |
| `not_found` | `not_found` |
| `permission_denied` | `denied` |
| `not_directory`, `is_directory`, `invalid` | `invalid_input` |
| `not_supported` | `unsupported` |
| `timeout` | `timeout` (`detail`에 그때까지의 `RunOutput`) |
| `shell_unavailable` | `unavailable` |
| `spawn_error`, `callback_error`, `unknown` | `internal` |

### 4.2 셸 실행과 샌드박스

1. `cwd`를 §4.3 규칙으로 해석한다(쓰기 root 검사는 하지 않고 읽기 root 안인지만 본다).
2. `xeon.sandbox`에 명령과 cwd를 넘겨 샌드박스 래핑을 받는다. 샌드박스 설정이 꺼져 있으면 래핑 없이 실행하고 `sandboxed: false`를 돌려준다. 켜고 끄는 설정은 L0.sandbox·L1.tools 소관이다(`_research/layer-plan-v2-notes.md` "OS 샌드박스가 왜 필요한가").
3. `xeon.sandbox`가 실행 전에 거부하면(정책상 금지, 샌드박스 필수인데 사용 불가) `denied` `CapabilityError`를 낸다. `detail`은 `{ by: "sandbox", reason: <L0.sandbox가 준 사유 코드> }`다. 도구 경로에서는 `isError: true` 결과가 된다.
4. 래핑한 명령을 `ExecutionEnv.exec`로 실행한다. 출력 spill 기준은 `l2.workspace.shell.maxLines`, `l2.workspace.shell.maxBytes`이고 남기는 쪽은 꼬리다(durable `bash.ts` `outputLimits: { retain: "tail" }`).
5. 실행 중 샌드박스 위반(커널이 막은 쓰기·네트워크)은 명령 자체의 실패로 나타난다. 종료 코드가 0이 아니면 3.3절 `exit_nonzero` 규칙을 따른다. 위반 보고를 L0.sandbox가 주면 `detail.sandboxViolations`에 싣는다 [가정].
6. 제한 시간: 입력 `timeoutSec` → 설정 기본값 순. 넘기면 `timeout` 오류이고 프로세스 그룹 전체를 종료한다(`L0.exec.spec`).

### 4.3 경로 해석과 탈출 검사

파일 도구는 다음 순서로 경로를 해석한다.

1. 정규화: 특수 공백(U+00A0, U+2000~U+200A, U+202F, U+205F, U+3000)을 일반 공백으로 바꾸고 앞의 `@`를 지운다(durable `tools/path-utils.ts` `normalizeToolPath`).
2. 절대화: `ExecutionEnv.absolutePath`로 cwd 기준 절대 경로를 만든다.
3. 읽기 변형(read만): 없으면 macOS 스크린샷 이름 변형(좁은 공백 AM/PM, NFD, 곡선 따옴표)을 차례로 시도한다(`resolveReadToolPath`).
4. 정규 경로: `ExecutionEnv.canonicalPath`로 심볼릭 링크와 `..`를 푼다. 대상이 아직 없으면(새 파일 쓰기) 존재하는 가장 가까운 상위 디렉터리의 정규 경로에 나머지 마디를 붙인다. 나머지 마디에 `..`가 있으면 거부한다.
5. 포함 검사: 정규 경로가 허용 root 가운데 하나의 안에 있어야 한다. 읽기 도구(`read`, `ls`, `grep`, `find`)는 읽기 root, 쓰기 도구(`write`, `edit`)는 쓰기 root와 비교한다. 비교는 경로 마디 단위다. 문자열 접두 비교는 쓰지 않는다(`/a/bc`는 `/a/b` 안이 아니다).
6. 보호 경로: 정규 경로가 L0.sandbox의 보호 경로 목록에 걸리면 root 안이어도 거부한다.

- 4·5·6번 위반은 `denied`다. `detail`은 `{ reason: "outside_root" | "protected_path" | "parent_traversal", requested: <입력 경로>, resolved: <정규 경로> }`다.
- `grep`, `find`는 검색 기준 디렉터리만 검사한다. 검색 중 만나는 심볼릭 링크는 따라가지 않는다(ripgrep 기본 동작, `--follow` 미사용).

역할 나눔 [제안]:

| 대상 | `cap-workspace` | `L1.tools` | `L0.sandbox` |
|---|---|---|---|
| 파일 도구 경로의 정규화, `..`·심볼릭 링크 탈출 검사 | 소유(위 1~5) | 결과를 받는다 | 관여 없음 |
| 허용 root 목록(작업 디렉터리, 추가 디렉터리, 사용자 승인으로 넓힌 경로) | 조회만 한다 | 소유(권한 모드, 규칙, 승인) | 쓰기 경로 설정을 공유한다 |
| 쓰기 도구의 승인 여부(묻기, 자동 허용) | 관여 없음 | 소유(`tool.call.before` 앞단 파이프라인) | 관여 없음 |
| bash 명령 문자열 안의 경로 | 검사하지 않는다(명령 해석은 불가) | 명령 패턴 규칙과 승인 | 커널 수준 강제(쓰기 root 밖 쓰기 거부, 보호 경로 읽기 거부, 네트워크 허용 목록) |
| 보호 경로 목록 | 조회해 파일 도구에도 적용 | 관여 없음 | 소유 |

- 허용 root를 얻는 API는 `L1.tools.spec`이 정한다 [가정]. 그 API가 생기기 전에는 읽기 root와 쓰기 root 모두 대화의 작업 폴더 하나로 둔다 [제안].
- [결정: review.m2-plan DG.4, open-issues M-06] 대화의 작업 폴더는 `thread.started`의 `workspace`(`ThreadSummaryRow.workspace`)다. 호출 문맥(`CallOptions.context.threadId`)으로 `xeon.session`의 대화 투영을 읽고(`ThreadWorkspaces.workspaceOf`), 값이 있으면 그 폴더가 다음 셋의 기준이 된다. (1) 상대 경로를 푸는 cwd, (2) 읽기·쓰기 root 하나, (3) `bash`의 기본 cwd와 샌드박스 쓰기 root. 실행 환경은 `xeon.exec`의 `withCwd`로 만든다. 값이 없거나(옛 행) 대화 문맥이 없으면 엔진의 cwd를 쓴다(M1 동작). 작업 폴더가 없는 경로를 가리키면 `not_found`이고 엔진 cwd로 물러나지 않는다. 한 엔진이 여러 프로젝트의 대화를 동시에 열어도 대화마다 root가 다르다.
- 같은 쓰기를 파일 도구는 L2에서 거부하고, bash는 L0 샌드박스가 거부한다. 파일 도구는 샌드박스를 거치지 않으므로 L2 검사가 유일한 경로 방어다.

### 4.4 편집 방식

durable `tools/edit-diff.ts`(500줄)를 포크한다. 규칙은 포크 원본 그대로이고 테스트 이름과 1:1로 대응한다(`L2.workspace.plan` §5).

| # | 규칙 | 원본 위치 | 테스트 이름 |
|---|---|---|---|
| E1 | 본문의 CRLF·CR을 LF로 바꾼 뒤 찾고, 쓸 때 원래 줄 끝으로 되돌린다 | `normalizeToLF`, `restoreLineEndings` | `edit restores CRLF line endings` |
| E2 | BOM을 떼고 찾고, 쓸 때 다시 붙인다 | `stripBom` | `edit preserves BOM` |
| E3 | 정확 일치를 먼저 시도한다. 모든 편집이 정확 일치하면 원문 공간에서 바꾼다 | `fuzzyFindText` 앞부분 | `edit prefers exact match` |
| E4 | 퍼지 정규화 1: 유니코드 NFKC | `normalizeForFuzzyMatch` | `edit fuzzy matches NFKC equivalents` |
| E5 | 퍼지 정규화 2: 각 줄 끝 공백 제거 | 같음 | `edit fuzzy ignores trailing whitespace` |
| E6 | 퍼지 정규화 3: 곡선 작은따옴표(U+2018~U+201B) → `'`, 곡선 큰따옴표(U+201C~U+201F) → `"` | 같음 | `edit fuzzy normalizes smart quotes` |
| E7 | 퍼지 정규화 4: 하이픈·대시·빼기 기호(U+2010~U+2015, U+2212) → `-` | 같음 | `edit fuzzy normalizes dashes` |
| E8 | 퍼지 정규화 5: 특수 공백(U+00A0, U+2002~U+200A, U+202F, U+205F, U+3000) → 공백 | 같음 | `edit fuzzy normalizes special spaces` |
| E9 | 한 편집이라도 퍼지 일치가 필요하면 모든 편집을 퍼지 공간에서 찾는다 | `applyEditsToNormalizedContent` `usedFuzzyMatch` | `edit switches all edits to fuzzy space` |
| E10 | 퍼지 공간에서 바꿀 때 바뀌지 않은 줄은 원문 그대로 둔다 | `applyReplacementsPreservingUnchangedLines` | `edit fuzzy preserves untouched lines` |
| E11 | 모든 편집은 원본 기준으로 찾는다. 앞 편집의 결과에 이어 찾지 않는다 | 같은 함수 | `edit matches every edit against original` |
| E12 | `oldText`가 빈 문자열이면 `edit_empty_old_text` | `getEmptyOldTextError` | `edit rejects empty oldText` |
| E13 | 찾지 못하면 `edit_not_found` | `getNotFoundError` | `edit rejects missing oldText` |
| E14 | 두 곳 이상에 있으면 `edit_ambiguous`(`detail.occurrences`) | `getDuplicateError` | `edit rejects ambiguous oldText` |
| E15 | 두 편집 구간이 겹치면 `edit_overlap` | 겹침 검사 | `edit rejects overlapping edits` |
| E16 | 결과가 원본과 같으면 `edit_no_change` | `getNoChangeError` | `edit rejects no-op edits` |
| E17 | 설정 `l2.workspace.edit.fuzzy`가 거짓이면 E4~E10을 쓰지 않고, 정확 일치 실패는 `edit_not_found`(`detail.fuzzyDisabled: true`) | Xeon 추가 | `edit fuzzy can be disabled` |

- 오류 `detail`은 `{ editIndex, totalEdits }`를 공통으로 싣는다. 원본 메시지 문구(`edits[i].oldText ...`)는 `message`에 그대로 둔다.
- 같은 경로의 동시 변경은 durable `tools/file-mutation-queue.ts`로 경로별로 줄 세운다. 다른 경로는 병렬로 돈다.
- 쓰기는 같은 디렉터리의 임시 파일에 쓰고 이름을 바꾸는 방식이 원자적이다. 포크 원본이 직접 덮어쓰는지 확인한 뒤 바꿀지 정한다 [미결 4].
- `FileChange.diff`는 외부 라이브러리 없이 `files/diff.ts`가 만든다(통합 diff, 문맥 3줄); pi의 `diff` 패키지는 쓰지 않는다 [결정: 오케스트레이터 기본값].

줄 해시 편집(2차, 설계 메모) [제안]:

- 출처는 omp `crates/pi-edit` hashline(Rust 약 7.3k줄)이다. N-API·Bun 전용 바인딩이라 코드를 가져오지 않고 알고리즘만 TS로 다시 쓴다(`_research/packages.md` §4.4 L2-a 2행).
- 모양: `read`가 줄마다 `<줄 번호>:<짧은 해시>` 표지를 붙여 보여 주고, 편집은 표지 범위로 지정한다. 적용 전에 현재 파일의 해당 줄 해시를 다시 계산해 다르면 거부한다(`edit_stale_anchor` 후보).
- 도입 방식: 새 메서드(`files.editAnchored` 후보)와 새 도구를 `workspace.files` minor 버전으로 더한다. `edit`의 정의는 바꾸지 않는다. 어느 모델에 어느 편집 도구를 줄지는 omp의 `edit.modelVariants` 같은 설정이 필요하고, 이는 도구 노출 정책이라 L1.tools와 함께 정한다.
- 해시 함수, 표지 길이, `read` 출력 형식 변경이 프롬프트 캐시와 fingerprint에 주는 영향을 2차 설계에서 비교한다.

### 4.5 출력 절단

- 원본은 durable `truncate.ts`(205줄, import 없음)다. 기본 한도는 2,000줄 또는 50KB 중 먼저 걸리는 쪽이고 줄 중간에서 자르지 않는다(`truncate.ts` `DEFAULT_MAX_LINES`, `DEFAULT_MAX_BYTES`).
- 위치 [결정: review.decisions-2 D-08]: 절단 함수의 포크 원본은 ADR-0003대로 `platform-exec`에 둔다. `cap-workspace`는 구현 패키지를 import하지 않고 F 서비스 인터페이스(`ExecutionEnv`, `@xeon/contracts/services`, 서비스 `xeon.exec`)로 절단을 호출한다. L1.tools의 결과 경계화도 같은 서비스를 쓴다. `cap-workspace/src/truncate/`에는 `read`의 이어 읽기 계산(offset, nextOffset, `TruncationInfo` 조립)만 둔다. 서비스 메서드는 `truncateHead`·`truncateHeadOf`·`formatSize`다(`L0.exec.spec` §3.1). `read`는 파일 앞부분만 읽으므로 앞부분과 전체 합계를 받는 `truncateHeadOf`를 부른다.
- `read`: 앞에서부터 남긴다. `offset`부터 `min(limit, maxLines)`줄을 읽고 바이트 한도를 넘으면 그 전 줄까지 남긴다. 남긴 줄이 끝까지가 아니면 `truncated = { by, shown, total, nextOffset: endLine + 1 }`이다. 첫 줄 하나가 바이트 한도를 넘으면 그 줄의 앞부분만 남기고 `by: "bytes"`, `nextOffset: startLine + 1`로 둔다(`TruncationResult.firstLineExceedsLimit`).
- `bash`: 꼬리를 남기고 넘친 출력은 spill 파일로 둔다(`fullOutputPath`). spill은 `ExecutionEnv.exec`가 한다.
- `grep`, `find`, `ls`: 항목 수 한도(`limit` 또는 설정 기본값)와 바이트 한도 중 먼저 걸리는 쪽에서 자른다. `by: "entries"` 또는 `"bytes"`. `grep`의 긴 줄은 설정 `l2.workspace.grep.maxLineLength`자에서 자른다.
- 한도는 모두 설정(§6)으로 바꿀 수 있다. 도구 설명 문자열에는 수치를 넣지 않는다. 설정 변경이 도구 fingerprint와 프롬프트 캐시를 바꾸지 않게 하기 위해서다(`F.capabilities.spec` §4.5).
- L1.tools의 결과 경계화는 도구 결과 전체에 한 번 더 적용된다. 이 문서의 한도가 그보다 작으면 L1 경계화는 아무 일도 하지 않는다.

### 4.6 이미지와 첨부

- 원본: durable `images/`(6파일 390줄, photon wasm, 워커 스레드)와 `tools/image-processor.ts`(`ImageProcessor`, `DEFAULT_IMAGE_LIMITS = { maxWidth: 2000, maxHeight: 2000, maxBytes: 4.5 MiB }`, `INLINE_IMAGE_TYPES`)(ADR-0003 §3.1).
- 처리 순서: 형식 판별 → (처리기가 있으면) 디코드, EXIF 방향 보정, 한도 안으로 리사이즈, 필요하면 재인코딩(BMP → PNG, 큰 PNG → JPEG) → base64 길이 검사 → blob 등록 → `WorkspaceImage` 반환.
- 처리기가 없을 때(최소형, §10 미결 2): `INLINE_IMAGE_TYPES`(png, jpeg, gif, webp)이고 base64 길이가 `maxBytes` 이하이면 그대로 등록한다. 그 밖은 `image_unsupported` 또는 `image_too_large`다. durable `read`가 처리기 없이 동작하는 방식과 같다(`image-processor.ts` 주석).
- blob 연결(자체 설계) [제안]:
  - 이미지 바이트는 L0 blob API로 `sys_blobs`에 sha256 키로 둔다. 같은 내용은 한 번만 저장된다.
  - 모델용 결과의 `ImageContent.data`에는 base64 대신 자리표시 문자열 `blob:sha256:<hex>`를 넣는다(`F.records.spec` §3.4 `BLOB_PLACEHOLDER_PREFIX`와 같은 형식). 이벤트와 아이템에는 이 참조만 남는다.
  - 모델 요청을 조립할 때 L1.context가 자리표시를 blob 내용(base64)으로 바꾼다. 이 치환 규칙은 `L1.context.spec`에 요청한다 [가정]. 치환 전 blob이 없으면 그 이미지를 `[이미지 없음: <hex>]` 텍스트로 바꾼다.
- [가정] photon wasm은 `bun build --compile` 산출물 안에서 로드된다. 확인하지 않았다(ADR-0003 §4.2). 대체 경로:
  1. wasm 파일을 Bun의 파일 임베드(`import ... with { type: "file" }`)로 바이너리에 넣고 실행 중에 읽는다.
  2. 그래도 로드에 실패하면 처리기 없이 동작한다(위 최소형). 시작 때 한 번 탐침하고 결과를 상태(`imageProcessor: "photon" | "none"`)로 둔다.
  3. 워커 스레드(`images/node-worker.ts`)가 Bun `Worker`에서 동작하지 않으면 메인 스레드에서 처리한다. 대신 큰 이미지 처리 중 이벤트 루프가 멈출 수 있다.
- 첨부: `dialog.attachments`가 `workspace.images.register`(붙여넣기 데이터)와 `load`(파일 첨부)를 부른다(`L2.readme` §6). 첨부 입력 경로와 사용자 메시지 결합은 `L2.dialog.spec`이 정한다.
- 이미지 입력 크기 상한: `register`의 base64 길이는 `l2.workspace.images.maxInputBytes`를 넘으면 처리 전에 `invalid_input`이다. 너무 큰 입력이 워커로 넘어가지 않게 한다.
- [결정: review.m2-plan DG.3] M2 최소형 구현 규칙:
  - 형식 판별은 pi `tools/image.ts`의 `detectSupportedImageMimeType`과 `imageDimensions`다(`PATCHES.md` P11). 선언한 `mimeType`보다 머리 바이트로 판별한 형식이 앞선다. 판별하지 못하면 `image_decode_failed`, bmp처럼 인라인 형식이 아니면 `image_unsupported`다. 애니메이션 PNG는 판별 대상이 아니라 `image_decode_failed`다.
  - 한도 검사는 base64 길이 대 `maxBytes`뿐이다. 픽셀 한도(`maxWidth`, `maxHeight`)는 처리기 없이 맞출 수 없어 검사하지 않고 헤더에서 읽은 크기만 결과의 `size`에 싣는다.
  - blob 등록은 `BlobSink.putBlob`(실제 구현은 `xeon.store`)이다. 저장소가 없으면 `unavailable`(`detail.reason: "blob_store_missing"`), 저장 실패는 `unavailable`(`detail.by: "store"`, 디스크 부족과 입출력 오류는 재시도 가능)이다.
  - `load`는 §4.3 경로 해석(읽기 변형 포함)을 거치고, 파일 크기가 `maxInputBytes`를 넘으면 읽기 전에 `invalid_input`이다. `resize`는 처리기가 들어오는 2차까지 `unsupported`다.
  - `read`가 이미지 파일을 만나면(blob 저장소가 있을 때만) 같은 경로로 준비해 `{ kind: "image", path, image }`를 돌려준다. 저장소가 없으면 이미지도 `read_binary`다.

### 4.7 재생과 결과 불명

- `read`, `ls`, `grep`, `find`와 `workspace.images` 메서드는 `safe`다. 재개 때 결과가 불명이면 다시 실행한다(`F.records.spec` §3.5 판정 표).
- `write`, `edit`, `bash`는 `unsafe`다. 의도 기록 뒤 결과가 불명이면 다시 실행하지 않고 결과 불명 합성 결과를 모델에 보낸다(`F.conversation.spec` §3.6 `ReplayPolicy`, `eng.transactions.design` §5).
- `write`는 같은 내용이면 결과가 같아 `idempotent: true` 힌트를 단다. 그래도 `replay`는 `unsafe`로 둔다. 다시 쓰기 사이에 사용자나 다른 도구가 파일을 바꿨을 수 있기 때문이다 [제안].

### 4.8 파일 복원과의 경계

- 파일 복원(되감기, 체크포인트로 돌아가기)은 `L1.persistence`가 소유한다. 이 도메인은 복원 API를 두지 않는다.
- `write`, `edit` 결과의 `FileChange.diff`는 사람이 보는 기록이고 복원 원본이 아니다. 복원에 쓸 이전 내용의 스냅샷을 어떻게 남길지(blob, git 객체 등)는 `L1.persistence.spec`이 정한다.

## 5. 실패와 경계 사례

| # | 상황 | 동작 |
|---|---|---|
| 1 | `read`의 `offset`이 파일 줄 수보다 큼 | `offset_beyond_end`. `detail.totalLines` |
| 2 | 이미지가 아닌 바이너리 파일 `read` | `read_binary`. 파일 앞 8KB에 NUL 바이트가 있으면 바이너리로 본다 [제안] |
| 3 | 디렉터리를 `read` | `invalid_input`(`is_directory`) |
| 4 | `../../etc/passwd` 또는 root 밖을 가리키는 심볼릭 링크 | `denied`, `reason: "outside_root"` |
| 5 | 새 파일 경로에 아직 없는 `..` 마디가 섞임 | `denied`, `reason: "parent_traversal"` |
| 6 | 샌드박스가 실행 전에 bash 명령을 거부 | `denied`, `detail.by: "sandbox"`. 도구 결과 `isError: true` |
| 7 | 샌드박스 안에서 root 밖 쓰기 시도 | 명령이 0 아닌 종료로 끝나 `exit_nonzero`. 위반 보고가 있으면 `detail.sandboxViolations` |
| 8 | bash 제한 시간 초과 | `timeout`. 프로세스 그룹 종료. `detail`에 그때까지의 `RunOutput` |
| 9 | 도구 실행 중 사용자 중단 | `aborted`. L1.tools가 중단 결과로 처리 |
| 10 | ripgrep 바이너리를 찾지 못함 | `grep`, `find`가 `unavailable`, `detail.reason: "rg_missing"` |
| 11 | 같은 파일에 `edit` 두 개가 한 라운드에서 병렬로 옴 | 경로별 줄 세우기로 차례로 적용. 두 번째 편집은 첫 번째 결과를 원본으로 본다 |
| 12 | 편집 중 다른 프로세스가 파일을 바꿈 | 읽은 시점 내용을 기준으로 쓰므로 그 변경을 덮어쓴다. 감지는 하지 않는다 [미결 4] |
| 13 | photon 로드 실패 | 처리기 없음 상태로 동작. 큰 이미지는 `image_too_large` |
| 14 | 이미지 blob이 요청 조립 시점에 없음 | L1.context가 텍스트 자리표시로 바꾼다(§4.6) |
| 15 | `ExecutionEnv`가 원격(SSH) 백엔드 | 같은 규칙으로 동작한다. 정규 경로와 root는 원격 파일 시스템 기준이다. ripgrep은 원격에 있어야 한다 [가정] |

## 6. 설정 노출

`F.wire-settings.spec` §3.8 형식. 모든 키의 `layer`는 `"L2"`, `since`는 `"0.1.0"`, `secret`은 `false`다.

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | ui.tab | secret |
|---|---|---|---|---|---|---|---|
| `l2.workspace.read.maxLines` | integer | 2000 | min 1, max 100000 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.read.maxBytes` | integer | 51200 | min 1024, max 10485760 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.shell.maxLines` | integer | 2000 | min 1, max 100000 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.shell.maxBytes` | integer | 51200 | min 1024, max 10485760 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.shell.defaultTimeoutSec` | integer | 0 | min 0, max 86400 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.grep.maxMatches` | integer | 100 | min 1, max 10000 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.grep.maxLineLength` | integer | 500 | min 80, max 10000 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.find.maxResults` | integer | 1000 | min 1, max 100000 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.list.maxEntries` | integer | 500 | min 1, max 10000 | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.edit.fuzzy` | boolean | true | — | nextTurn | managed, user, project, local, session | tools | false |
| `l2.workspace.images.maxWidth` | integer | 2000 | min 64, max 16384 | nextTurn | managed, user, project, local | tools | false |
| `l2.workspace.images.maxHeight` | integer | 2000 | min 64, max 16384 | nextTurn | managed, user, project, local | tools | false |
| `l2.workspace.images.maxBytes` | integer | 4718592 | min 1024, max 52428800 | nextTurn | managed, user, project, local | tools | false |
| `l2.workspace.images.maxInputBytes` | integer | 41943040 | min 1024, max 268435456 | nextTurn | managed, user | tools | false |
| `l2.workspace.grep.rgPath` | string | `""` | — | restart | managed, user | tools | false |

- `shell.defaultTimeoutSec`의 0은 제한 없음이다(pi durable `bash`의 기본값과 같다).
- `grep.rgPath`가 빈 문자열이면 `xeon.os`의 `resolveBinary("rg")`가 돌려주는 경로를 쓴다. `@vscode/ripgrep`은 `platform-os`가 번들하고 이 패키지는 그 경로로 `rg`를 실행만 한다(`ExecutionEnv.exec`) [결정: review.m2-plan §8]. 범위를 관리·사용자로 제한한다. 프로젝트 설정 파일이 실행 파일 경로를 바꾸게 두면 저장소를 여는 것만으로 임의 바이너리가 실행될 수 있기 때문이다 [제안]. `find`도 같은 바이너리(`rg --files --glob`)를 쓴다(§10 미결 6).
- 이미지 한도의 기본값은 durable `DEFAULT_IMAGE_LIMITS`와 같다. 모델 provider별 한도가 더 작으면 L1.models가 요청 조립 때 다시 줄인다 [가정].
- UI 위젯: integer 키는 `number`, boolean은 `toggle`, string은 `text`. `ui.label`은 한국어로 둔다(예: `read.maxLines` → "읽기 최대 줄 수").

## 7. 확장 지점

- 이 문서는 지점을 새로 정의하지 않는다.
- 7개 도구 호출은 `tool.call.before`(fold first), `tool.result`(fold chain), `tool.execution.before`·`update`·`end`(tap)를 지난다(`F.extensions.spec` §3.4 13~17번). 페이로드의 `capability: { id, method }`로 대상을 고를 수 있다(`F.capabilities.spec` §7).
- 사용 예: L3 그룹은 쓰기를 막는 단계에서 `tool.call.before`의 `first` 핸들러로 `workspace.files`의 `write`·`edit`과 `workspace.shell`의 `run`을 거부한다(`product.scope.spec` §4.4 M2 종료 조건). 판정 근거는 도구 이름 대신 `capability.id`와 `hints.readOnly`를 쓰는 쪽을 [제안]한다.
- 그룹 코드가 `WorkspaceFilesKey`로 서비스를 직접 부르면 tool 지점을 지나지 않는다(`F.capabilities.spec` §3.9 그룹 경로). 이때도 §4.3 경로 검사와 §4.2 샌드박스는 그대로 적용된다. 승인 파이프라인(L1.tools)은 거치지 않는다.

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `WorkspaceFiles`, `WorkspaceShell`, `WorkspaceImages`와 각 `…Key` | `L1.tools.spec`(도구 어댑터), L3 그룹 spec |
| `WorkspaceService`, `WorkspaceServiceName` | `L2.readme` §5.6, X.primitives.spec |
| `FileChange`, `FileChangeSchema` | `L2.artifacts.spec`(리뷰), L4 UI |
| `WorkspaceImage`, `ImageLimits`, `ImageBlobRefSchema` | `L2.dialog.spec`(첨부), `L1.context.spec`(자리표시 치환) |
| `TruncationInfo`, `TruncationInfoSchema` | 다른 L2 도메인의 목록형 출력(선택) |

요구:

| 이름 | 출처 |
|---|---|
| `ExecutionEnv`, `CancelScope`, `xeon.exec` | `L0.exec.spec`, ADR-0003 |
| 샌드박스 래핑·사전 거부 API, 보호 경로 목록, `xeon.sandbox` | `L0.sandbox.spec` |
| blob 등록 API(`sys_blobs`) | `L0.store.spec` |
| 허용 root 조회, 결과 경계화, 도구 어댑터, 절단 함수 위치 | `L1.tools.spec` |
| `blob:sha256:` 자리표시 치환 | `L1.context.spec` |
| `defineCapability`, `serviceKey`, `ToolContent`, `CapabilityError` | `F.capabilities.spec` |
| `ReplayPolicy`, `ImageContent` | `F.conversation.spec` |
| 서비스 이름 `xeon.workspace`, 접두사 예약 | `eng.context-map.design` §4.1, §5 |

## 9. 수용 기준

1. `ExecutionEnv` 가짜 구현(`@xeon/platform-exec/testing`의 `fakeExec`와 메모리 파일 시스템) 위에서 7개 도구(`read`, `write`, `edit`, `ls`, `grep`, `find`, `bash`)가 같은 입력에 같은 결과(`structuredContent` 바이트 일치)를 낸다. `grep`, `find`는 ripgrep 실행을 가짜 `exec` 응답 표로 대신한다.
2. `WorkspaceFiles`, `WorkspaceShell`, `WorkspaceImages` 각각에 대해 `validateCapability`의 이슈가 0건이고, 세 정의를 합친 `validateCapabilitySet` 이슈도 0건이다.
3. §4.4 표의 규칙 E1~E17이 같은 이름의 테스트와 1:1로 대응하고 모두 통과한다. 표에 없는 테스트 이름이나 테스트가 없는 규칙이 있으면 실패하는 검사를 둔다.
4. `l2.workspace.read.maxLines`보다 긴 파일을 `read`하면 결과의 `truncated.nextOffset`이 `endLine + 1`이고, 그 값으로 다시 `read`하면 이어지는 줄부터 나온다.
5. `../` 조합, root 밖을 가리키는 심볼릭 링크, 존재하지 않는 `..` 마디가 섞인 새 파일 경로가 모두 `denied` `CapabilityError`를 낸다.
6. 가짜 `xeon.sandbox`가 실행 전 거부를 돌려주면 `bash` 도구 결과가 `isError: true`이고 `details.code`가 `denied`다.
7. `read`, `ls`, `grep`, `find`의 메서드와 도구 `replay`가 `"safe"`이고 `executionMode`가 `"parallel"`, `hints.readOnly`가 참이다. `write`, `edit`, `bash`의 `replay`는 `"unsafe"`다(정의 상수 검사).
8. 0이 아닌 종료 코드의 `bash` 도구 결과는 `isError: true`이고 `content`에 출력 꼬리가 있다. 같은 명령을 서비스로 `failOnNonZero` 없이 부르면 오류 없이 `exitCode`를 돌려준다.
9. 이미지 파일 `read` 결과의 `content`에 `ImageContent`가 있고 `data`가 `blob:sha256:`로 시작하며, 같은 파일을 두 번 읽으면 같은 sha256이다.
10. `cap-workspace`의 `src/`와 `test/`에 `chord` import가 0건이다(ADR-0003 §4.2 검증 방법 1~3).

## 10. 미결 사항

1. [결정: review.decisions-2 D-08] 절단 함수 위치. 포크 원본은 `platform-exec`에 두고 `cap-workspace`는 F 서비스(`ExecutionEnv`)로 호출한다(§4.5).
2. [결정: review.m2-plan DG.3] `workspace.images` 최소형(처리기 없음)을 M2에 둔다. JSON은 "이미지와 첨부 처리" 2차이고 `dialog.attachments`(M2)는 이 능력을 필수로 쓴다(`L2.readme` §2 각주). 구현은 §4.6.
3. [미결] `ImageBlobRefSchema`의 중복. F capabilities는 records를 import하지 않으므로 같은 모양을 적었다. `BlobRef`를 conversation이나 base로 내려 공유할지 F 문서가 정한다. 그 전까지는 두 스키마의 JSON이 같은지 테스트로 확인한다.
4. [미결] 원자적 쓰기와 동시 변경 감지. 포크 원본의 `writeFile`이 직접 덮어쓰는지 확인하고, 임시 파일 + 이름 바꾸기와 읽은 시점 해시 비교(낙관적 동시성)를 넣을지 정한다.
5. [미결] 도구 없는 능력(`workspace.images`) 허용(`F.capabilities.spec` §4.4).
6. [미결] `find`의 엔진. pi coding-agent `find`는 `fd`를 내려받아 쓴다(`core/tools/find.ts` `ensureTool("fd")`). 내려받기를 피하려고 `rg --files --glob`로 바꾸는 것을 제안한다. glob 의미(기본 이름 일치 대 전체 경로 일치)가 `fd`와 달라질 수 있어 테스트로 고정한다.
7. [미결] 허용 root 조회 API의 이름과 모양(`L1.tools.spec`). M1은 cwd 하나, M2는 대화의 작업 폴더 하나로 둔다(§4.3, open-issues M-06). 추가 디렉터리와 사용자가 승인해 넓힌 경로는 L1.tools의 API가 정해진 뒤에 더한다.
8. [미결] `bash` `executionMode: "sequential"`의 비용. 같은 라운드의 읽기 도구까지 순차가 된다. 실측 뒤 `parallel`로 바꿀지 정한다.
9. [미결] 0 아닌 종료 코드를 `exit_nonzero` 오류로 내는 방식(§3.3). F `ToolContent`에 `isError` 필드를 더해 정상 출력으로 `isError`를 표시하는 대안이 있다. F 문서의 판단이 필요하다.
10. [미결] 모델용 도구 설명 문구의 언어. pi 원문은 영어다. 이 문서는 F 예시를 따라 한국어로 썼다. 모델 품질 비교 뒤 정한다.
11. [미결] `l2.workspace.images.*`를 세션 범위에서 바꿀 수 있게 할지. 지금은 세션 범위를 뺐다.
12. [미결] 패치 적용 메서드. `L2.artifacts.spec`의 거절 hunk 되돌림 안 A는 `workspace.files`에 패치 적용 서비스 메서드(`applyPatch` 후보, 도구 없음, `unsafe`)를 요구한다. 그 안이 채택되면 `workspace.files` minor 버전으로 더하고 §4.3 경로 검사와 §4.4 줄 세우기를 그대로 적용한다. 채택 전에는 `edit`로 같은 일을 할 수 있다.
13. [미결] 내용 주소(sha256) blob 쓰기(`images.register`)의 분류. 같은 바이트는 같은 blob이라 재실행해도 결과와 효과가 같지만, ADR-0015 §3.3은 `requestId` 기억이 있는 쓰기만 `idempotent`로 둔다. 지금은 선언 없음이다. 내용 주소 쓰기를 `idempotent`로 인정하려면 ADR의 정의를 넓혀야 한다.
