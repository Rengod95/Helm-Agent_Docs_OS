import { defineCapability } from "@fresnel/contracts/capabilities";
import { Type } from "typebox";
import type {
  ExtensionLayer,
  ExtensionManifest,
  ExtMethodDecl,
  GroupDecl,
  HookName,
  PluginDecl,
  RegistrationDef,
  RegistrationSetup,
  TrustRequest,
} from "@fresnel/contracts/extensions";
import type {
  AssistantMessage,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@fresnel/contracts/conversation";
import type { ExtThreadSnapshot, RecordCommitPort } from "@fresnel/contracts/records";
import {
  capabilityDefTable,
  type CapabilityDefLookup,
  type ExtensionUnit,
} from "../../../src/primitives/index.ts";

/** 기록 포트의 스냅샷. 읽기 실패는 시험 결함이므로 던진다 */
export async function snapshotOf(
  records: Pick<RecordCommitPort, "loadThread">,
  threadId: Parameters<RecordCommitPort["loadThread"]>[0],
): Promise<ExtThreadSnapshot> {
  const loaded = await records.loadThread(threadId);
  if (!loaded.ok) throw new Error(`loadThread failed: ${loaded.error.kind}`);
  return loaded.value;
}

const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};

export const userText: UserMessage = {
  role: "user",
  content: "hello",
  timestamp: 1_700_000_000_002,
};

export const assistantStop: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "answer" }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage,
  stopReason: "stop",
  timestamp: 1_700_000_000_004,
};

/**
 * 루트 플러그인(id 없음) 하나의 선언과 확장 수준 필드. 루트 뒤의 플러그인은 `extraPlugins`로 준다.
 * 루트의 `layer`는 생략하면 `plugin`(그룹이면 `L3`)이다
 */
export interface ManifestInput {
  readonly name: string;
  /** 플러그인 그룹이면 `{}`(구성원은 모든 플러그인), 구성원을 고르려면 `{ members: [...] }` */
  readonly group?: GroupDecl;
  /** 확장 수준 기본 켜짐. 루트 플러그인의 기본값이 된다 */
  readonly defaultEnabled?: boolean;
  readonly layer?: ExtensionLayer;
  readonly hooks?: readonly HookName[];
  readonly usesPost?: boolean;
  readonly drives?: boolean;
  readonly requires?: PluginDecl["requires"];
  readonly optional?: PluginDecl["optional"];
  readonly provides?: PluginDecl["provides"];
  readonly recordKinds?: PluginDecl["recordKinds"];
  readonly readsRecordKinds?: PluginDecl["readsRecordKinds"];
  readonly replaces?: PluginDecl["replaces"];
  /** 확장 수준 신뢰 요청 */
  readonly trust?: ExtensionManifest["trust"];
  /** 루트 뒤에 붙는 플러그인 선언. 각각 `id`가 있어야 한다 */
  readonly extraPlugins?: readonly PluginDecl[];
  /** 확장 수준 메서드 선언(F.extensions.spec §3.1.1). 처리기 등록(`registerMethod`)은 이 목록의 동사만 받는다 */
  readonly methods?: ExtMethodDecl[];
}

/** validateManifest를 통과하는 최소 매니페스트(스키마 2). 루트 플러그인 하나와 `extraPlugins` */
export function makeManifest(input: ManifestInput): ExtensionManifest {
  const root: PluginDecl = {
    layer: input.layer ?? (input.group === undefined ? "plugin" : "L3"),
    hooks: [...(input.hooks ?? [])],
    ...(input.usesPost === undefined ? {} : { usesPost: input.usesPost }),
    ...(input.drives === undefined ? {} : { drives: input.drives }),
    ...(input.requires === undefined ? {} : { requires: input.requires }),
    ...(input.optional === undefined ? {} : { optional: input.optional }),
    ...(input.provides === undefined ? {} : { provides: input.provides }),
    ...(input.recordKinds === undefined ? {} : { recordKinds: input.recordKinds }),
    ...(input.readsRecordKinds === undefined ? {} : { readsRecordKinds: input.readsRecordKinds }),
    ...(input.replaces === undefined ? {} : { replaces: input.replaces }),
  };
  return {
    schemaVersion: 2,
    name: input.name,
    version: "0.1.0",
    entry: "./src/index.ts",
    plugins: [root, ...(input.extraPlugins ?? [])],
    ...(input.defaultEnabled === undefined ? {} : { defaultEnabled: input.defaultEnabled }),
    ...(input.trust === undefined ? {} : { trust: input.trust }),
    ...(input.group === undefined ? {} : { group: input.group }),
    ...(input.methods === undefined ? {} : { methods: input.methods }),
  };
}

export interface UnitInput<S> extends ManifestInput {
  readonly def?: RegistrationDef<S>;
  readonly loadIndex?: number;
  readonly builtin?: boolean;
  /** 로더가 정한 유효 등급(단위의 `trust`). 매니페스트 `trust`(요청)와 따로 준다. 생략하면 host가 정한다 */
  readonly loadedTrust?: TrustRequest["level"];
  readonly initialEnabled?: boolean;
}

/** 루트 플러그인의 Registration 하나를 정의하는 확장 단위. 나머지 플러그인은 등록하지 않는다 */
export function makeUnit<S = never>(
  input: UnitInput<S>,
  setup: RegistrationSetup<S>,
): ExtensionUnit {
  const manifest = makeManifest(input);
  return {
    manifest,
    entry: ({ register }) => {
      register(manifest.name, input.def ?? {}, setup);
    },
    loadIndex: input.loadIndex ?? 0,
    builtin: input.builtin ?? true,
    ...(input.loadedTrust === undefined ? {} : { trust: input.loadedTrust }),
    ...(input.initialEnabled === undefined ? {} : { initialEnabled: input.initialEnabled }),
  };
}

/** 타입은 undefined지만 런타임에는 value를 돌려주는 핸들러. 스키마 위반 결정을 시험한다 */
export function returning(value: unknown): () => undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 계약 위반 주입: 결정 스키마를 어긴 반환값을 흉내 낸다 (eng.typescript.guide TY-06)
  return () => value as undefined;
}

export const toolResultMessage: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "call_1",
  toolName: "read",
  content: [{ type: "text", text: "file body" }],
  isError: false,
  timestamp: 1_700_000_000_005,
};

/** drive를 쓰는 플러그인 그룹 확장 단위: `group: {}`와 루트 플러그인 `drives: true` */
export function makeGroupUnit<S = never>(
  input: Omit<UnitInput<S>, "group" | "drives">,
  setup: RegistrationSetup<S>,
): ExtensionUnit {
  return makeUnit({ ...input, group: {}, drives: true }, setup);
}

/** 시험 전용: 타입을 어긴 값을 흉내 낸다. 스키마·가드가 막는지 확인할 때만 쓴다 */
export function unsafeInput(value: unknown): never {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 계약 위반 주입: 타입 위반 입력을 만든다 (eng.typescript.guide TY-06)
  return value as never;
}

/** 거부된 이유를 돌려준다. 거부되지 않으면 undefined. bun의 rejects 매처는 await-thenable 규칙과 맞지 않아 쓰지 않는다 */
export async function rejectionOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const echoText = Type.Object(
  { text: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
const echoOut = Type.String();

/** 시험용 기능 `demo.echo`: `echo`는 멱등 쓰기, `peek`는 읽기, `poke`는 선언 없는 쓰기 */
const echoCapability = defineCapability({
  id: "demo.echo",
  version: "1.0.0",
  description: "echo",
  service: {
    methods: {
      echo: {
        description: "echo",
        input: echoText,
        output: echoOut,
        replay: "safe",
        idempotent: true,
      },
      peek: {
        description: "peek",
        input: echoText,
        output: echoOut,
        replay: "safe",
        readOnly: true,
      },
      poke: { description: "poke", input: echoText, output: echoOut, replay: "unsafe" },
    },
  },
  tools: [],
});

export const echoDefs: CapabilityDefLookup = capabilityDefTable([echoCapability]);
