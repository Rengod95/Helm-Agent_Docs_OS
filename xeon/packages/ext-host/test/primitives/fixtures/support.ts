import type { ExtensionManifest, ScopeDef, ScopeSetup } from "@xeon/contracts/extensions";
import type {
  AssistantMessage,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@xeon/contracts/conversation";
import type { ExtThreadSnapshot, RecordCommitPort } from "@xeon/contracts/records";
import type { ExtensionUnit } from "../../../src/primitives/index.ts";

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

export interface ManifestInput {
  readonly name: string;
  readonly layer?: ExtensionManifest["layer"];
  readonly kind?: ExtensionManifest["kind"];
  readonly points?: ExtensionManifest["points"];
  readonly usesPost?: boolean;
  readonly usesDrive?: boolean;
  readonly defaultEnabled?: boolean;
  readonly requires?: ExtensionManifest["requires"];
  readonly optional?: ExtensionManifest["optional"];
  readonly provides?: ExtensionManifest["provides"];
  readonly recordKinds?: ExtensionManifest["recordKinds"];
  readonly readsRecordKinds?: ExtensionManifest["readsRecordKinds"];
}

/** validateManifest를 통과하는 최소 매니페스트 */
export function makeManifest(input: ManifestInput): ExtensionManifest {
  const kind = input.kind ?? "plugin";
  return {
    schemaVersion: 1,
    name: input.name,
    version: "0.1.0",
    layer: input.layer ?? (kind === "group" ? "L3" : "plugin"),
    kind,
    entry: "./src/index.ts",
    points: input.points ?? [],
    usesDrive: input.usesDrive ?? false,
    ...(input.usesPost === undefined ? {} : { usesPost: input.usesPost }),
    ...(input.defaultEnabled === undefined ? {} : { defaultEnabled: input.defaultEnabled }),
    ...(input.requires === undefined ? {} : { requires: input.requires }),
    ...(input.optional === undefined ? {} : { optional: input.optional }),
    ...(input.provides === undefined ? {} : { provides: input.provides }),
    ...(input.recordKinds === undefined ? {} : { recordKinds: input.recordKinds }),
    ...(input.readsRecordKinds === undefined ? {} : { readsRecordKinds: input.readsRecordKinds }),
  };
}

export interface UnitInput<S> extends ManifestInput {
  readonly def?: ScopeDef<S>;
  readonly loadIndex?: number;
  readonly builtin?: boolean;
  readonly initialEnabled?: boolean;
}

/** 주 scope 하나를 정의하는 확장 단위 */
export function makeUnit<S = never>(input: UnitInput<S>, setup: ScopeSetup<S>): ExtensionUnit {
  const manifest = makeManifest(input);
  return {
    manifest,
    entry: ({ scope }) => {
      scope(manifest.name, input.def ?? {}, setup);
    },
    loadIndex: input.loadIndex ?? 0,
    builtin: input.builtin ?? true,
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

/** drive를 쓰는 그룹 확장 단위 */
export function makeGroupUnit<S = never>(
  input: Omit<UnitInput<S>, "kind" | "usesDrive">,
  setup: ScopeSetup<S>,
): ExtensionUnit {
  return makeUnit({ ...input, kind: "group", usesDrive: true }, setup);
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
