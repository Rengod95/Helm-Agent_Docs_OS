// 훑기 자식 프로세스의 줄 형식(migration.md §7.4 [제안]). 자식은 표준 입력의 요청 한 줄을 읽고, 표준 출력에 진행 줄과 끝 줄 하나를 쓴다.
// 엔진은 자식의 줄을 `parseScanChildLine`으로만 받는다(경계 값, TY-10). 바이트 배열은 JSON에 실을 수 없어서 `{ "base64": "..." }`로 옮긴다:
// 자식은 `scanJsonReplacer`로 쓰고, 엔진은 `decodeScanItem`으로 되돌린다. 이 파일은 타입과 순수 함수만 갖는다(시각, 파일, 프로세스 없음).
import { Type } from "typebox";
import {
  assertNever,
  parse,
  type ParseError,
  type Result,
  type SchemaProof,
  type SchemaSound,
} from "@fresnel/contracts";
import type {
  HarnessId,
  IrKind,
  IrNode,
  ItemScope,
  ItemSecret,
  ScanDiagnostic,
  SourceItem,
} from "./types.ts";

// ── 타입: 자식이 쓰는 모양. 바이트만 `{ base64 }`이고 나머지는 `SourceItem`과 같다 ──

interface ScanWireBytes {
  readonly base64: string;
}

interface ScanWireSkillFile {
  readonly path: string;
  readonly bytes: ScanWireBytes;
}

type ScanWireIr =
  | {
      readonly kind: "instruction";
      readonly name: string;
      readonly text: string;
      readonly activation: "always" | "globs";
      readonly globs: readonly string[];
      readonly role: "user_global" | "rule" | "project_file" | "agents_md";
      readonly onlyAgentsMdImport: boolean;
      readonly parts: readonly { readonly source: string; readonly text: string }[];
    }
  | {
      readonly kind: "skill";
      readonly dirName: string;
      readonly name?: string;
      readonly description?: string;
      readonly files: readonly ScanWireSkillFile[];
    }
  | {
      readonly kind: "command";
      readonly name: string;
      readonly relPath: string;
      readonly text: string;
      readonly description?: string;
      readonly hasSubstitutions: boolean;
    }
  | {
      readonly kind: "agent";
      readonly fileName: string;
      readonly name?: string;
      readonly description?: string;
      readonly prompt: string;
      readonly tools?: readonly string[];
      readonly disallowedTools?: readonly string[];
      readonly model?: string;
      readonly permissionMode?: string;
    }
  | {
      readonly kind: "mcp";
      readonly serverName: string;
      readonly id?: string;
      readonly transport: "stdio" | "http" | "sse" | "ws" | "unknown";
      readonly def?: {
        readonly transport:
          | {
              readonly type: "stdio";
              readonly command: string;
              readonly args?: readonly string[];
              readonly cwd?: string;
              readonly env?: Readonly<Record<string, string>>;
            }
          | {
              readonly type: "http" | "sse";
              readonly url: string;
              readonly headers?: Readonly<Record<string, string>>;
              readonly oauth?: boolean;
            };
        readonly timeouts?: { readonly connectMs?: number; readonly callMs?: number };
      };
      readonly secretRefs: readonly {
        readonly place: string;
        readonly varName: string;
        readonly secretName: string;
        readonly origin: "env_ref" | "literal";
      }[];
      readonly projectBound: boolean;
    }
  | {
      readonly kind: "field";
      readonly container: string;
      readonly key: string;
      readonly summary?: string;
    }
  | { readonly kind: "blocked"; readonly of: IrKind; readonly code: string; readonly text: string }
  | {
      readonly kind: "hook";
      readonly event: string;
      readonly matcher?: string;
      readonly handler: string;
      readonly timeoutSeconds?: number;
      readonly extraKeys: readonly string[];
      readonly code?: string;
      readonly env?: {
        readonly command: string;
        readonly shell: "sh" | "bash";
        readonly refs: readonly { readonly path: string; readonly hash: string | null }[];
        readonly refsKnown: boolean;
        readonly readsInputs: readonly string[];
        readonly firstWord?: string;
        readonly missingTools: readonly string[];
        readonly versionHints: readonly string[];
        readonly notes: readonly string[];
      };
    };

interface ScanWireItem {
  readonly itemId: string;
  readonly harness: HarnessId;
  readonly kind: IrKind;
  readonly scope: ItemScope;
  readonly rootLabel: string;
  readonly path: string;
  readonly keyPath?: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly ir: ScanWireIr;
  readonly secrets: readonly ItemSecret[];
  readonly warnings: readonly string[];
}

/** 자식이 쓰는 줄 세 가지: 루트 하나가 끝난 진행, 끝 응답, 실패 응답. 실패 코드는 짧은 식별자다(원문과 경로를 싣지 않는다) */
type ScanChildLine =
  | { readonly kind: "progress"; readonly done: number; readonly total: number }
  | {
      readonly kind: "ok";
      readonly limitReached: boolean;
      readonly scan: {
        readonly scanned: readonly string[];
        readonly items: readonly ScanWireItem[];
        readonly diagnostics: readonly ScanDiagnostic[];
      };
    }
  | { readonly kind: "error"; readonly code: string };

/** 엔진이 자식의 표준 입력에 쓰는 요청 한 줄. 루트는 엔진이 정규 경로로 바꾼 값이다 */
export interface ScanRequest {
  readonly roots: readonly {
    readonly path: string;
    readonly scope: "user" | "project";
    readonly label: string;
  }[];
  readonly homeDir: string;
}

// ── 스키마: 위 타입의 검증 모양. 정적 타입이 손으로 쓴 타입에 대입되는지 컴파일러가 증명한다(TY-26 U5) ──

const CLOSED = { additionalProperties: false } as const;

/** base64의 정규 형식. 이 패턴을 통과한 값은 `Uint8Array.fromBase64`가 던지지 않는다 */
const BASE64_PATTERN = "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$";

function lit<T extends string>(value: T) {
  return Type.Literal(value);
}

const HarnessShape = Type.Union([lit("claude-code"), lit("agents-md"), lit("agent-skills")]);

const IrKindShape = Type.Union([
  lit("instruction"),
  lit("skill"),
  lit("command"),
  lit("agent"),
  lit("mcp"),
  lit("field"),
  lit("blocked"),
  lit("hook"),
]);

const ItemScopeShape = Type.Union([
  lit("user"),
  lit("project"),
  lit("local"),
  lit("managed"),
  lit("plugin"),
]);

const DiagnosticShape = Type.Object(
  {
    code: Type.Union([
      lit("unreadable"),
      lit("too_large"),
      lit("invalid_json"),
      lit("limit"),
      lit("invalid_frontmatter"),
    ]),
    path: Type.String(),
    message: Type.String(),
  },
  CLOSED,
);

const ItemSecretShape = Type.Object(
  {
    keyPath: Type.String(),
    kind: Type.Union([lit("env_ref"), lit("literal")]),
    name: Type.Optional(Type.String()),
  },
  CLOSED,
);

const StringMapShape = Type.Record(Type.String(), Type.String());

const WireIrShape = Type.Union([
  Type.Object(
    {
      kind: lit("instruction"),
      name: Type.String(),
      text: Type.String(),
      activation: Type.Union([lit("always"), lit("globs")]),
      globs: Type.Array(Type.String()),
      role: Type.Union([lit("user_global"), lit("rule"), lit("project_file"), lit("agents_md")]),
      onlyAgentsMdImport: Type.Boolean(),
      parts: Type.Array(Type.Object({ source: Type.String(), text: Type.String() }, CLOSED)),
    },
    CLOSED,
  ),
  Type.Object(
    {
      kind: lit("skill"),
      dirName: Type.String(),
      name: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      files: Type.Array(
        Type.Object(
          {
            path: Type.String(),
            bytes: Type.Object({ base64: Type.String({ pattern: BASE64_PATTERN }) }, CLOSED),
          },
          CLOSED,
        ),
      ),
    },
    CLOSED,
  ),
  Type.Object(
    {
      kind: lit("command"),
      name: Type.String(),
      relPath: Type.String(),
      text: Type.String(),
      description: Type.Optional(Type.String()),
      hasSubstitutions: Type.Boolean(),
    },
    CLOSED,
  ),
  Type.Object(
    {
      kind: lit("agent"),
      fileName: Type.String(),
      name: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      prompt: Type.String(),
      tools: Type.Optional(Type.Array(Type.String())),
      disallowedTools: Type.Optional(Type.Array(Type.String())),
      model: Type.Optional(Type.String()),
      permissionMode: Type.Optional(Type.String()),
    },
    CLOSED,
  ),
  Type.Object(
    {
      kind: lit("mcp"),
      serverName: Type.String(),
      id: Type.Optional(Type.String()),
      transport: Type.Union([lit("stdio"), lit("http"), lit("sse"), lit("ws"), lit("unknown")]),
      def: Type.Optional(
        Type.Object(
          {
            transport: Type.Union([
              Type.Object(
                {
                  type: lit("stdio"),
                  command: Type.String(),
                  args: Type.Optional(Type.Array(Type.String())),
                  cwd: Type.Optional(Type.String()),
                  env: Type.Optional(StringMapShape),
                },
                CLOSED,
              ),
              Type.Object(
                {
                  type: Type.Union([lit("http"), lit("sse")]),
                  url: Type.String(),
                  headers: Type.Optional(StringMapShape),
                  oauth: Type.Optional(Type.Boolean()),
                },
                CLOSED,
              ),
            ]),
            timeouts: Type.Optional(
              Type.Object(
                { connectMs: Type.Optional(Type.Number()), callMs: Type.Optional(Type.Number()) },
                CLOSED,
              ),
            ),
          },
          CLOSED,
        ),
      ),
      secretRefs: Type.Array(
        Type.Object(
          {
            place: Type.String(),
            varName: Type.String(),
            secretName: Type.String(),
            origin: Type.Union([lit("env_ref"), lit("literal")]),
          },
          CLOSED,
        ),
      ),
      projectBound: Type.Boolean(),
    },
    CLOSED,
  ),
  Type.Object(
    {
      kind: lit("field"),
      container: Type.String(),
      key: Type.String(),
      summary: Type.Optional(Type.String()),
    },
    CLOSED,
  ),
  Type.Object(
    { kind: lit("blocked"), of: IrKindShape, code: Type.String(), text: Type.String() },
    CLOSED,
  ),
  Type.Object(
    {
      kind: lit("hook"),
      event: Type.String(),
      matcher: Type.Optional(Type.String()),
      handler: Type.String(),
      timeoutSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      extraKeys: Type.Array(Type.String()),
      code: Type.Optional(Type.String()),
      env: Type.Optional(
        Type.Object(
          {
            command: Type.String({ minLength: 1, maxLength: 4096 }),
            shell: Type.Union([lit("sh"), lit("bash")]),
            refs: Type.Array(
              Type.Object(
                {
                  path: Type.String({ minLength: 1, maxLength: 1024 }),
                  hash: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
                },
                CLOSED,
              ),
              { maxItems: 16 },
            ),
            refsKnown: Type.Boolean(),
            readsInputs: Type.Array(Type.String()),
            firstWord: Type.Optional(Type.String()),
            missingTools: Type.Array(Type.String()),
            versionHints: Type.Array(Type.String()),
            notes: Type.Array(Type.String()),
          },
          CLOSED,
        ),
      ),
    },
    CLOSED,
  ),
]);

const WireItemShape = Type.Object(
  {
    itemId: Type.String(),
    harness: HarnessShape,
    kind: IrKindShape,
    scope: ItemScopeShape,
    rootLabel: Type.String(),
    path: Type.String(),
    keyPath: Type.Optional(Type.String()),
    sha256: Type.String(),
    bytes: Type.Integer({ minimum: 0 }),
    ir: WireIrShape,
    secrets: Type.Array(ItemSecretShape),
    warnings: Type.Array(Type.String()),
  },
  CLOSED,
);

const lineShape = Type.Union([
  Type.Object(
    {
      kind: lit("progress"),
      done: Type.Integer({ minimum: 0 }),
      total: Type.Integer({ minimum: 0 }),
    },
    CLOSED,
  ),
  Type.Object(
    {
      kind: lit("ok"),
      limitReached: Type.Boolean(),
      scan: Type.Object(
        {
          scanned: Type.Array(Type.String()),
          items: Type.Array(WireItemShape),
          diagnostics: Type.Array(DiagnosticShape),
        },
        CLOSED,
      ),
    },
    CLOSED,
  ),
  Type.Object({ kind: lit("error"), code: Type.String({ minLength: 1, maxLength: 64 }) }, CLOSED),
]);

const requestShape = Type.Object(
  {
    roots: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 4096 }),
          scope: Type.Union([lit("user"), lit("project")]),
          label: Type.String({ maxLength: 256 }),
        },
        CLOSED,
      ),
    ),
    homeDir: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  CLOSED,
);

const ScanChildLineSchema = Type.Unsafe<ScanChildLine>(
  lineShape satisfies SchemaSound<ScanChildLine, typeof lineShape>,
);

const ScanRequestSchema = Type.Unsafe<ScanRequest>(
  requestShape satisfies SchemaProof<ScanRequest, typeof requestShape>,
);

/** 자식이 쓴 한 줄을 검증한다. 경계 값이라 `unknown`으로 받는다(TY-10). 바이트 형식까지 본다 */
export function parseScanChildLine(input: unknown): Result<ScanChildLine, ParseError> {
  return parse(ScanChildLineSchema, input);
}

/** 엔진이 보낸 요청 한 줄을 검증한다(자식 쪽 경계) */
export function parseScanRequest(input: unknown): Result<ScanRequest, ParseError> {
  return parse(ScanRequestSchema, input);
}

/** 치환 함수의 본체. `this`는 값을 가진 객체(holder)다. 내보내는 함수가 `this`를 쓰지 않도록 여기에 둔다 */
function replaceBytes(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const raw: unknown = this[key];
  return raw instanceof Uint8Array ? { base64: raw.toBase64() } : value;
}

/**
 * `JSON.stringify`의 치환 함수. 바이트 배열은 `{ "base64": ... }`로 쓴다. 읽기 호출이 주는 `Buffer`는 `toJSON`이 먼저 바꾸므로
 * 원래 값은 `this[key]`에서 읽는다. 첫 인자는 키라서 값보다 앞에 둔다
 */
export const scanJsonReplacer: (
  this: Record<string, unknown>,
  key: string,
  value: unknown,
) => unknown = replaceBytes;

function decodeIr(wire: ScanWireIr): IrNode {
  switch (wire.kind) {
    case "instruction":
      return wire;
    case "skill":
      return {
        kind: "skill",
        dirName: wire.dirName,
        name: wire.name,
        description: wire.description,
        files: wire.files.map((file) => ({
          path: file.path,
          bytes: Uint8Array.fromBase64(file.bytes.base64),
        })),
      };
    case "command":
      return {
        kind: "command",
        name: wire.name,
        relPath: wire.relPath,
        text: wire.text,
        description: wire.description,
        hasSubstitutions: wire.hasSubstitutions,
      };
    case "agent":
      return {
        kind: "agent",
        fileName: wire.fileName,
        name: wire.name,
        description: wire.description,
        prompt: wire.prompt,
        tools: wire.tools,
        disallowedTools: wire.disallowedTools,
        model: wire.model,
        permissionMode: wire.permissionMode,
      };
    case "mcp":
      return {
        kind: "mcp",
        serverName: wire.serverName,
        id: wire.id,
        transport: wire.transport,
        def: wire.def,
        secretRefs: wire.secretRefs,
        projectBound: wire.projectBound,
      };
    case "field":
      return {
        kind: "field",
        container: wire.container,
        key: wire.key,
        summary: wire.summary,
      };
    case "blocked":
      return wire;
    case "hook":
      return {
        kind: "hook",
        event: wire.event,
        matcher: wire.matcher,
        handler: wire.handler,
        timeoutSeconds: wire.timeoutSeconds,
        extraKeys: wire.extraKeys,
        code: wire.code,
        env: wire.env,
      };
    default:
      return assertNever(wire, "ScanWireIr");
  }
}

/**
 * 자식이 쓴 항목을 `SourceItem`으로 되돌린다. 선택 필드가 없으면 `undefined`인 필드로 옮긴다(라이브러리 타입이 그렇다).
 * 입력은 `parseScanChildLine`을 통과한 값이어야 한다(바이트 문자열의 형식을 이미 검사했다).
 */
export function decodeScanItem(wire: ScanWireItem): SourceItem {
  return {
    itemId: wire.itemId,
    harness: wire.harness,
    kind: wire.kind,
    scope: wire.scope,
    rootLabel: wire.rootLabel,
    path: wire.path,
    ...(wire.keyPath === undefined ? {} : { keyPath: wire.keyPath }),
    sha256: wire.sha256,
    bytes: wire.bytes,
    ir: decodeIr(wire.ir),
    secrets: wire.secrets,
    warnings: wire.warnings,
  };
}
