import { Type, type Static, type TLiteral, type TUnion, type TUnsafe } from "typebox";
import { SemVerRangeSchema } from "../capabilities/index.ts";
import { attempt, parse } from "../base/index.ts";
import type { SchemaProof, SchemaSound } from "../base/schema-proof.ts";

// F.extensions.spec §3.1.1 Plugin UI 기여(ADR-0021 §3.3, §3.4.1, §3.4.2). 정본은 이 파일이다.
// 검사 함수 validateUi / validateUiTree는 순수 함수이고 파일을 읽지 않는다(경로 존재는 X 로더가 본다).

export const UI_SCHEMA_VERSION = 1 as const;

export const UiModeSchema: TUnion<[TLiteral<"native">, TLiteral<"app">]> = Type.Union([
  Type.Literal("native"),
  Type.Literal("app"),
]);
export type UiMode = Static<typeof UiModeSchema>;

export const PLACEMENTS = ["page", "panel", "card", "status", "command", "settings"] as const;
export type Placement = (typeof PLACEMENTS)[number];
export const PlacementSchema: TUnion<
  [
    TLiteral<"page">,
    TLiteral<"panel">,
    TLiteral<"card">,
    TLiteral<"status">,
    TLiteral<"command">,
    TLiteral<"settings">,
  ]
> = Type.Union([
  Type.Literal("page"),
  Type.Literal("panel"),
  Type.Literal("card"),
  Type.Literal("status"),
  Type.Literal("command"),
  Type.Literal("settings"),
]);

/** Plugin UI 기여 id. 전체 id는 "<확장이름>/<id>"다 */
export const UI_ID_PATTERN: string = "^[a-z][a-z0-9-]{0,31}$";

/** 크기 상한(ADR-0021 §3.2, §3.4). Placement별 개수 상한은 PLACEMENT_LIMITS다 */
export const UI_LIMITS = {
  treeNodes: 2000,
  treeDepth: 24,
  queryResultBytes: 262144,
  eventRows: 500,
  bridgeMessageBytes: 1048576,
  bridgeMessagesPerSecond: 50,
  minPollSeconds: 5,
  /** 파일 읽기(`pickFile`, `readFolderFile`)와 `saveFile` 쓰기 내용의 상한(바이트). 셸의 `PICK_READ_MAX_BYTES`와 같다 */
  fileBytes: 67108864,
  /** 파일 내용이 오가는 다리 메시지 하나의 상한(바이트). 글자 이스케이프와 base64 부풀림(4/3)을 받도록 `fileBytes`의 두 배에 봉투 몫을 더했다 */
  bridgeFileMessageBytes: 135266304,
  /** `notify` 확장·화면당 분당 상한(남용 방지 수준) */
  notifyPerMinute: 30,
  /** `writeSetting` 화면당 분당 상한(남용 방지 수준) */
  settingWritesPerMinute: 120,
  /** `listFolder` 한 번에 돌려주는 항목 수 상한. 넘으면 `truncated`다 */
  folderListEntries: 10000,
  /** `listFolder`가 내려가는 하위 폴더 깊이 상한 */
  folderListDepth: 16,
} as const;

/** 프레임이 셸 기능을 쓰려면 앱 선언에 적어야 하는 권한(ADR-0021 §3.4.3). 적지 않은 권한은 `not_declared`로 막힌다 */
export const BRIDGE_CAPABILITIES = ["files", "notify", "settingsWrite", "secrets"] as const;
export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[number];
const BridgeCapabilitySchema = Type.Union(BRIDGE_CAPABILITIES.map((name) => Type.Literal(name)));

/** Placement별 확장당 개수 상한. card는 kind마다 1이라 별도 검사한다 */
export const PLACEMENT_LIMITS: Readonly<Record<Placement, number>> = {
  page: 4,
  panel: 1,
  card: Number.POSITIVE_INFINITY,
  status: 1,
  command: 16,
  settings: 1,
};

/** Placement가 받는 모드. command는 화면이 없어 모드를 쓰지 않는다 */
export const PLACEMENT_MODES: Readonly<Record<Placement, readonly UiMode[]>> = {
  page: ["native", "app"],
  panel: ["native", "app"],
  card: ["native"],
  status: ["native"],
  command: ["native"],
  settings: ["native"],
};

/** 확장 패키지 안 상대 경로 */
const RelativePathSchema = Type.String({ minLength: 1, maxLength: 512 });

export interface AppDecl {
  /** Plugin App 파일 폴더. 예 "./ui/graph" */
  readonly root: string;
  /** root 안 HTML. 예 "index.html" */
  readonly entry: string;
  /** 다리 API 범위(SemVer 범위). 예 "^1.0.0" */
  readonly bridge: string;
  /** Native UI로 그릴 수 없는 이유 한 줄. 빈 문자열은 검사가 막는다 */
  readonly reason: string;
  /** 다리로 쓸 셸 기능 권한. 생략하면 없다(ADR-0021 §3.4.3) */
  readonly capabilities?: readonly BridgeCapability[];
}
const AppDeclShape = Type.Object(
  {
    root: RelativePathSchema,
    entry: RelativePathSchema,
    bridge: SemVerRangeSchema,
    reason: Type.String({ maxLength: 256 }),
    capabilities: Type.Optional(
      Type.Array(BridgeCapabilitySchema, { maxItems: BRIDGE_CAPABILITIES.length }),
    ),
  },
  { additionalProperties: false },
);
export const AppDeclSchema: TUnsafe<AppDecl> = Type.Unsafe<AppDecl>(
  AppDeclShape satisfies SchemaProof<AppDecl, typeof AppDeclShape>,
);

export interface UiContribution {
  readonly id: string;
  readonly placement: Placement;
  /** 생략하면 "native" */
  readonly mode?: UiMode;
  readonly title: string;
  readonly icon?: string;
  /** native: 화면 트리 JSON 경로 */
  readonly file?: string;
  /** app: Plugin App 선언 */
  readonly app?: AppDecl;
  /** app: Plugin App 금지 때 쓰는 화면 트리 JSON 경로 */
  readonly fallback?: string;
  /** card 전용 레코드 kind */
  readonly forKind?: string;
  readonly when?: { readonly thread?: "required" | "optional" };
}
const UiContributionShape = Type.Object(
  {
    id: Type.String({ pattern: UI_ID_PATTERN }),
    placement: PlacementSchema,
    mode: Type.Optional(UiModeSchema),
    title: Type.String({ minLength: 1, maxLength: 128 }),
    icon: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    file: Type.Optional(RelativePathSchema),
    app: Type.Optional(AppDeclSchema),
    fallback: Type.Optional(RelativePathSchema),
    forKind: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    when: Type.Optional(
      Type.Object(
        { thread: Type.Optional(Type.Union([Type.Literal("required"), Type.Literal("optional")])) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export const UiContributionSchema: TUnsafe<UiContribution> = Type.Unsafe<UiContribution>(
  UiContributionShape satisfies SchemaProof<UiContribution, typeof UiContributionShape>,
);

export interface UiDecl {
  readonly schemaVersion: 1;
  /** native 화면이 있으면 필수. 위젯 카탈로그 범위(SemVer 범위) */
  readonly widgets?: string;
  readonly items: readonly UiContribution[];
  /** 메시지 카탈로그 폴더. 예 "./locales" */
  readonly messages?: string;
}
const UiDeclShape = Type.Object(
  {
    schemaVersion: Type.Literal(UI_SCHEMA_VERSION),
    widgets: Type.Optional(SemVerRangeSchema),
    items: Type.Array(UiContributionSchema, { maxItems: 64 }),
    messages: Type.Optional(RelativePathSchema),
  },
  { additionalProperties: false },
);
export const UiDeclSchema: TUnsafe<UiDecl> = Type.Unsafe<UiDecl>(
  UiDeclShape satisfies SchemaProof<UiDecl, typeof UiDeclShape>,
);

// ── 화면 트리(ADR-0021 §3.4.1) ───────────────────────────────────────────

/** RFC 6901 JSON Pointer. 빈 문자열은 문서 전체 */
export const JSON_POINTER_PATTERN: string = "^(/([^~/]|~[01])*)*$";

export const UI_FORMATS = [
  "duration",
  "bytes",
  "relativeTime",
  "number",
  "percent",
  "dateTime",
] as const;
export type UiFormat = (typeof UI_FORMATS)[number];

export interface UiBinding {
  /** JSON Pointer */
  readonly path: string;
  readonly format?: UiFormat;
}
export interface UiEach {
  readonly path: string;
  /** 반복 안에서 항목을 가리키는 이름 */
  readonly as: string;
}
export type UiScalar = string | number | boolean | null;
export interface UiCondition {
  readonly path: string;
  readonly op: "eq" | "ne" | "exists" | "missing";
  readonly value?: UiScalar;
}
export interface UiNode {
  /** 위젯 카탈로그 이름. 카탈로그 목록 검사는 렌더러가 한다 */
  readonly type: string;
  /** variant, tone, size 같은 선택값과 글자만. 색, 크기 숫자, CSS, HTML은 받지 않는다(DP-08) */
  readonly props?: Readonly<Record<string, UiScalar>>;
  /** 속성 이름 → 데이터 경로 */
  readonly bind?: Readonly<Record<string, UiBinding>>;
  readonly each?: UiEach;
  readonly when?: UiCondition;
  readonly children?: readonly UiNode[];
}

const UiScalarSchema = Type.Union([
  Type.String({ maxLength: 2048 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);

const UiBindingSchema = Type.Object(
  {
    path: Type.String({ pattern: JSON_POINTER_PATTERN, maxLength: 256 }),
    format: Type.Optional(Type.Union(UI_FORMATS.map((name) => Type.Literal(name)))),
  },
  { additionalProperties: false },
);
const UiEachSchema = Type.Object(
  {
    path: Type.String({ pattern: JSON_POINTER_PATTERN, maxLength: 256 }),
    as: Type.String({ pattern: "^[a-z][A-Za-z0-9]{0,31}$" }),
  },
  { additionalProperties: false },
);
const UiConditionSchema = Type.Object(
  {
    path: Type.String({ pattern: JSON_POINTER_PATTERN, maxLength: 256 }),
    op: Type.Union([
      Type.Literal("eq"),
      Type.Literal("ne"),
      Type.Literal("exists"),
      Type.Literal("missing"),
    ]),
    value: Type.Optional(UiScalarSchema),
  },
  { additionalProperties: false },
);

const UiNodeCyclic = Type.Cyclic(
  {
    UiNode: Type.Object(
      {
        type: Type.String({ pattern: "^[A-Z][A-Za-z0-9]{0,47}$" }),
        props: Type.Optional(
          Type.Record(Type.String({ pattern: "^[a-z][A-Za-z0-9]{0,31}$" }), UiScalarSchema),
        ),
        bind: Type.Optional(
          Type.Record(Type.String({ pattern: "^[a-z][A-Za-z0-9]{0,31}$" }), UiBindingSchema),
        ),
        each: Type.Optional(UiEachSchema),
        when: Type.Optional(UiConditionSchema),
        children: Type.Optional(Type.Array(Type.Ref("UiNode"))),
      },
      { additionalProperties: false },
    ),
  },
  "UiNode",
);
export const UiNodeSchema: TUnsafe<UiNode> = Type.Unsafe<UiNode>(
  UiNodeCyclic satisfies SchemaSound<UiNode, typeof UiNodeCyclic>,
);

export type UiTreeIssueCode = "ui_invalid" | "ui_limit";
export interface UiTreeIssue {
  readonly code: UiTreeIssueCode;
  /** JSON Pointer */
  readonly path: string;
  readonly message: string;
}
export type UiTreeResult =
  | { readonly ok: true; readonly tree: UiNode }
  | { readonly ok: false; readonly issues: readonly UiTreeIssue[] };

/** 노드 수와 깊이를 센다. 입력은 스키마를 통과한 트리다 */
function measure(node: UiNode, depth: number): { nodes: number; depth: number } {
  let nodes = 1;
  let deepest = depth;
  for (const child of node.children ?? []) {
    const inner = measure(child, depth + 1);
    nodes += inner.nodes;
    deepest = Math.max(deepest, inner.depth);
  }
  return { nodes, depth: deepest };
}

/** 화면 트리 JSON 하나. 모양은 스키마가, 크기는 UI_LIMITS가 본다. 순수 함수 */
export function validateUiTree(input: unknown): UiTreeResult {
  const parsed = parse(UiNodeSchema, input);
  if (!parsed.ok) {
    return {
      ok: false,
      issues: parsed.error.issues.map((found) => ({
        code: "ui_invalid",
        path: found.path,
        message: found.message,
      })),
    };
  }
  const size = measure(parsed.value, 1);
  const issues: UiTreeIssue[] = [];
  if (size.nodes > UI_LIMITS.treeNodes) {
    issues.push({
      code: "ui_limit",
      path: "",
      message: `tree has ${size.nodes} nodes, the limit is ${UI_LIMITS.treeNodes}`,
    });
  }
  if (size.depth > UI_LIMITS.treeDepth) {
    issues.push({
      code: "ui_limit",
      path: "",
      message: `tree depth is ${size.depth}, the limit is ${UI_LIMITS.treeDepth}`,
    });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, tree: parsed.value };
}

// ── Plugin App 다리 메시지(ADR-0021 §3.4.2) ──────────────────────────────────

export const BRIDGE_VERSION = 1 as const;

/** 요청 op. 호스트 API 아홉, 셸 기능 여덟(`pickFile`~`registerSecret`, 앱 선언 권한이 필요하다)과 resize, log, pong */
export const BRIDGE_OPS = [
  "query",
  "events",
  "settings",
  "host",
  "call",
  "command",
  "post",
  "requestApproval",
  "navigate",
  "pickFile",
  "pickFolder",
  "listFolder",
  "readFolderFile",
  "saveFile",
  "notify",
  "writeSetting",
  "registerSecret",
  "resize",
  "log",
  "pong",
] as const;
export type BridgeOp = (typeof BRIDGE_OPS)[number];

/** 셸이 먼저 보내는 푸시. `ping`은 생존 확인이고 Plugin App은 `pong` 요청으로 답한다(§3.7) */
export const BRIDGE_PUSHES = ["theme", "host", "event", "invalidate", "ping"] as const;
export type BridgePush = (typeof BRIDGE_PUSHES)[number];

/** 다리 오류 이름. 문장은 클라이언트가 만든다 */
export const BRIDGE_ERROR_KINDS = [
  "op_not_allowed",
  "args_invalid",
  "not_declared",
  "extension_off",
  "safe_mode",
  "too_large",
  "rate_limited",
  "denied",
  "failed",
] as const;
export type BridgeErrorKind = (typeof BRIDGE_ERROR_KINDS)[number];

export interface BridgeRequest {
  readonly v: 1;
  readonly id: number;
  readonly op: BridgeOp;
  readonly args: unknown;
}
export interface BridgeError {
  readonly kind: BridgeErrorKind;
  readonly detail?: string;
}
export type BridgeResponse =
  | { readonly v: 1; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly v: 1; readonly id: number; readonly ok: false; readonly error: BridgeError };
export interface BridgePushMessage {
  readonly v: 1;
  readonly push: BridgePush;
  readonly value: unknown;
}
/** Plugin App이 처음 보내는 `ready`. 셸은 이 메시지에만 포트를 넘긴다 */
export interface BridgeReady {
  readonly v: 1;
  readonly ready: true;
  readonly bridge: string;
  /** 셸이 프레임 주소 조각(`#n=<nonce>`)으로 준 값을 되돌려 보낸다. 셸이 nonce를 냈으면 같아야 포트를 넘긴다 */
  readonly nonce?: string;
}

const BridgeIdSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const BridgeOpSchema = Type.Union(BRIDGE_OPS.map((name) => Type.Literal(name)));
const BridgePushNameSchema = Type.Union(BRIDGE_PUSHES.map((name) => Type.Literal(name)));
const BridgeErrorSchema = Type.Object(
  {
    kind: Type.Union(BRIDGE_ERROR_KINDS.map((name) => Type.Literal(name))),
    detail: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);

const BridgeRequestShape = Type.Object(
  { v: Type.Literal(BRIDGE_VERSION), id: BridgeIdSchema, op: BridgeOpSchema, args: Type.Unknown() },
  { additionalProperties: false },
);
export const BridgeRequestSchema: TUnsafe<BridgeRequest> = Type.Unsafe<BridgeRequest>(
  BridgeRequestShape satisfies SchemaProof<BridgeRequest, typeof BridgeRequestShape>,
);
const BridgeResponseUnion = Type.Union([
  Type.Object(
    {
      v: Type.Literal(BRIDGE_VERSION),
      id: BridgeIdSchema,
      ok: Type.Literal(true),
      value: Type.Unknown(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      v: Type.Literal(BRIDGE_VERSION),
      id: BridgeIdSchema,
      ok: Type.Literal(false),
      error: BridgeErrorSchema,
    },
    { additionalProperties: false },
  ),
]);
export const BridgeResponseSchema: TUnsafe<BridgeResponse> = Type.Unsafe<BridgeResponse>(
  BridgeResponseUnion satisfies SchemaSound<BridgeResponse, typeof BridgeResponseUnion>,
);
const BridgePushShape = Type.Object(
  { v: Type.Literal(BRIDGE_VERSION), push: BridgePushNameSchema, value: Type.Unknown() },
  { additionalProperties: false },
);
export const BridgePushSchema: TUnsafe<BridgePushMessage> = Type.Unsafe<BridgePushMessage>(
  BridgePushShape satisfies SchemaProof<BridgePushMessage, typeof BridgePushShape>,
);
const BridgeReadyShape = Type.Object(
  {
    v: Type.Literal(BRIDGE_VERSION),
    ready: Type.Literal(true),
    bridge: SemVerRangeSchema,
    nonce: Type.Optional(Type.String({ minLength: 8, maxLength: 64 })),
  },
  { additionalProperties: false },
);
export const BridgeReadySchema: TUnsafe<BridgeReady> = Type.Unsafe<BridgeReady>(
  BridgeReadyShape satisfies SchemaProof<BridgeReady, typeof BridgeReadyShape>,
);

/** 파일 내용을 싣는 요청·응답의 op. 이 op의 메시지는 `bridgeFileMessageBytes`까지 받는다 */
export const BRIDGE_FILE_OPS: ReadonlySet<string> = new Set([
  "pickFile",
  "listFolder",
  "readFolderFile",
  "saveFile",
]);

/**
 * 메시지 직렬화 크기가 상한 안인가. `limit`을 주지 않으면 `bridgeMessageBytes`(1 MiB)이고, 파일 op 메시지는 호출자가
 * `UI_LIMITS.bridgeFileMessageBytes`를 준다. JSON으로 직렬화되지 않는 값(순환, BigInt, undefined)은 거짓이다
 */
export function bridgeMessageWithinLimit(
  message: unknown,
  limit: number = UI_LIMITS.bridgeMessageBytes,
): boolean {
  const text = attempt((): string | undefined => JSON.stringify(message));
  if (!text.ok || text.value === undefined) return false;
  return new TextEncoder().encode(text.value).byteLength <= limit;
}
