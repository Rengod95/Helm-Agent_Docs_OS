import { assertNever, err, ok, parse, type Result } from "@fresnel/contracts";
import {
  ExtensionLayerSchema,
  PluginIdSchema,
  type ExtensionLayer,
} from "@fresnel/contracts/extensions";
import type { DevkitError, MemberOp, PluginMode } from "@fresnel/contracts/services";
import { arrayOf, invalid } from "./errors.ts";
import { isRecord, isSafeRelative } from "./shared.ts";

// L3.authoring.spec §3.3 `editMembers`의 계획부. 구성원 편집 명령을 원본 매니페스트에 위에서 아래로 적용하고,
// 쓸 파일과 옮길 파일을 돌려준다. 이 모듈은 파일을 쓰지 않는다. 쓰기는 members.ts와 scaffold.ts가 계획 뒤에 한다.
// 뿌리 플러그인(id 없는 plugins[] 항목)은 구성원이 아니다. `plugins[]` 순서가 등록 순서이고, 엔트리는 이 순서로
// register하므로 등록 순서(훅 순서의 동점 기준, F.extensions.spec 훅 순서)가 된다.

/** plugins[] 상한(PluginDecl 목록 상한 16). 뿌리 플러그인도 센다 */
const PLUGINS_LIMIT = 16;
/** hook 방식 구성원이 거는 훅 */
const MEMBER_HOOK = "boundary.settle.after";
export const MEMBERS_DIR = "src/members";
export const MEMBERS_GENERATED_PATH = "src/members.generated.ts";
export const ENTRY_PATH = "src/index.ts";

/** 원본 매니페스트 JSON 객체. 이 모듈이 모르는 키는 그대로 둔다 */
export type RawManifest = Record<string, unknown>;
type RawDecl = Record<string, unknown>;

export type FileAction =
  | { readonly kind: "write"; readonly path: string; readonly text: string }
  | { readonly kind: "move"; readonly from: string; readonly to: string };

export interface MemberPlan {
  readonly manifest: RawManifest;
  /** 적용 순서대로 한다 */
  readonly actions: readonly FileAction[];
  /** 구성원에서 뺐지만 코드 파일을 남긴 id(지우지 않는다) */
  readonly kept: readonly string[];
  /** 편집 뒤 코드 파일(`src/members/<id>.ts`)이 있는 구성원 id, plugins[] 순서 */
  readonly coded: readonly string[];
}

interface State {
  readonly manifest: RawManifest;
  /** 편집 뒤 `src/members/`에 있는 코드 파일의 id 집합 */
  readonly files: ReadonlySet<string>;
  readonly actions: readonly FileAction[];
  readonly kept: readonly string[];
}

const ROOT_DECL: RawDecl = { layer: "plugin", hooks: [] };

/**
 * 구성원 편집을 계획한다. `existing`은 지금 `src/members/`에 있는 코드 파일의 id 집합이다.
 * 한 건이라도 실패하면 `invalid`나 `not_found`를 돌려주고 아무것도 계획하지 않는다
 */
export function planMembers(
  manifest: RawManifest,
  existing: ReadonlySet<string>,
  ops: readonly MemberOp[],
): Result<MemberPlan, DevkitError> {
  let state: State = { manifest, files: existing, actions: [], kept: [] };
  for (const op of ops) {
    const next = applyOp(state, op);
    if (!next.ok) return next;
    state = next.value;
  }
  const plugins = pluginsIn(state.manifest);
  if (!plugins.ok) return plugins;
  const coded = plugins.value.flatMap((decl) => {
    const id = idOf(decl);
    return id !== undefined && state.files.has(id) ? [id] : [];
  });
  return ok({ manifest: state.manifest, actions: state.actions, kept: state.kept, coded });
}

/** 구성원 코드 파일 하나의 기본 내용. 빈 setup이고 훅과 동작은 호출자가 더한다 */
function memberStubText(id: string): string {
  return [
    'import type { RegistrationApi } from "@fresnel/contracts/extensions";',
    "",
    `// ${id} 구성원. 훅과 동작은 이 setup에 더하고, 더한 훅은 매니페스트의 이 구성원 hooks에도 적는다.`,
    "export function setup(_g: RegistrationApi<unknown>): void {}",
    "",
  ].join("\n");
}

/** 생성 파일 `src/members.generated.ts`의 내용. `coded`는 코드 파일이 있는 구성원 id(plugins[] 순서)다 */
export function membersGeneratedText(coded: readonly string[]): string {
  const imports = coded.map(
    (id, index) =>
      `import { setup as setupOf${index} } from ${JSON.stringify(`./members/${id}.ts`)};`,
  );
  const entries = coded.map((id, index) => `  ${JSON.stringify(id)}: setupOf${index},`);
  const type = "Readonly<Record<string, (g: RegistrationApi<unknown>) => void | Promise<void>>>";
  const table = entries.length === 0 ? "{};" : ["{", ...entries, "};"].join("\n");
  return [
    "// 생성 파일: 직접 고치지 않는다",
    'import type { RegistrationApi } from "@fresnel/contracts/extensions";',
    ...imports,
    "",
    `export const memberSetups: ${type} = ${table}`,
    "",
  ].join("\n");
}

const GENERATED_IMPORT = /from\s+["']\.\/members\.generated(?:\.ts)?["']/;

/** 엔트리 글이 생성 파일을 가져오는가 */
export function entryImportsGenerated(text: string): boolean {
  return GENERATED_IMPORT.test(text);
}

function applyOp(state: State, op: MemberOp): Result<State, DevkitError> {
  switch (op.kind) {
    case "add":
      return addMember(state, op);
    case "rename":
      return renameMember(state, op);
    case "remove":
      return removeMember(state, op);
    case "move":
      return moveMember(state, op);
    default:
      return assertNever(op, "MemberOp");
  }
}

function addMember(
  state: State,
  op: Extract<MemberOp, { readonly kind: "add" }>,
): Result<State, DevkitError> {
  const id = op.id;
  if (!parse(PluginIdSchema, id).ok) return err(invalid(`plugin id "${id}" is not valid`));
  const plugins = pluginsIn(state.manifest);
  if (!plugins.ok) return plugins;
  if (plugins.value.some((decl) => idOf(decl) === id))
    return err(invalid(`plugin id "${id}" already exists`));
  if (plugins.value.length >= PLUGINS_LIMIT)
    return err(invalid(`plugins holds at most ${PLUGINS_LIMIT} entries, the root plugin included`));

  const root = plugins.value.find((decl) => idOf(decl) === undefined);
  const rootLayer = (root === undefined ? undefined : layerOf(root)) ?? "plugin";
  const head = plugins.value[0];
  const headLayer = head === undefined ? undefined : layerOf(head);
  const layer = op.layer ?? rootLayer;
  const mode: PluginMode = op.mode ?? "hook";
  if (headLayer !== undefined && (layer === "plugin") !== (headLayer === "plugin"))
    return err(
      invalid(
        `layer ${layer} cannot be mixed with layer ${headLayer} in one extension (plugin is external)`,
      ),
    );
  if (mode === "drive" && layer !== "L3")
    return err(invalid(`a drive member needs layer L3, not ${layer}`));

  const decl: RawDecl = {
    id,
    layer,
    ...(op.title === undefined ? {} : { title: op.title }),
    defaultEnabled: false,
    hooks: mode === "hook" ? [MEMBER_HOOK] : [],
    ...(mode === "drive" ? { drives: true } : {}),
  };
  const orchestration = orchestrationIn(state.manifest);
  if (!orchestration.ok) return orchestration;
  const base: RawDecl = orchestration.value ?? {};
  const members = membersOf(base);
  const manifest = withKey(
    withKey(state.manifest, "plugins", [...plugins.value, decl]),
    "orchestration",
    withKey(base, "members", members === undefined ? undefined : [...members, id]),
  );

  if (mode === "inject" || state.files.has(id)) return ok({ ...state, manifest });
  const path = memberPathOf(id);
  if (!path.ok) return path;
  const stub: FileAction = { kind: "write", path: path.value, text: memberStubText(id) };
  return ok({
    ...state,
    manifest,
    actions: [...state.actions, stub],
    files: new Set([...state.files, id]),
  });
}

function renameMember(
  state: State,
  op: Extract<MemberOp, { readonly kind: "rename" }>,
): Result<State, DevkitError> {
  const plugins = pluginsIn(state.manifest);
  if (!plugins.ok) return plugins;
  const at = plugins.value.findIndex((decl) => idOf(decl) === op.id);
  if (at < 0) return err(missing(state.manifest, op.id));
  const to = op.to;
  if (!parse(PluginIdSchema, to).ok) return err(invalid(`plugin id "${to}" is not valid`));
  if (plugins.value.some((decl) => idOf(decl) === to))
    return err(invalid(`plugin id "${to}" already exists`));
  const orchestration = orchestrationIn(state.manifest);
  if (!orchestration.ok) return orchestration;

  let actions = state.actions;
  let files = state.files;
  if (state.files.has(op.id)) {
    if (state.files.has(to))
      return err(invalid(`${MEMBERS_DIR}/${to}.ts already exists; move or delete it first`));
    const from = memberPathOf(op.id);
    if (!from.ok) return from;
    const target = memberPathOf(to);
    if (!target.ok) return target;
    const move: FileAction = { kind: "move", from: from.value, to: target.value };
    actions = [...actions, move];
    const moved = new Set(state.files);
    moved.delete(op.id);
    moved.add(to);
    files = moved;
  }

  const renamed = plugins.value.map((decl, index) =>
    index === at ? withKey(decl, "id", to) : decl,
  );
  const orch = orchestration.value;
  const manifest = withKey(
    withKey(state.manifest, "plugins", renamed),
    "orchestration",
    orch === undefined ? undefined : renameRefs(orch, op.id, to),
  );
  return ok({ ...state, manifest, actions, files });
}

function removeMember(
  state: State,
  op: Extract<MemberOp, { readonly kind: "remove" }>,
): Result<State, DevkitError> {
  const plugins = pluginsIn(state.manifest);
  if (!plugins.ok) return plugins;
  const at = plugins.value.findIndex((decl) => idOf(decl) === op.id);
  if (at < 0) return err(missing(state.manifest, op.id));
  const orchestration = orchestrationIn(state.manifest);
  if (!orchestration.ok) return orchestration;

  const blockIds = blockIdsFor(orchestration.value, op.id);
  if (blockIds.length > 0)
    return err(
      invalid(
        `plugin "${op.id}" is used by composition block(s) ${blockIds.join(", ")}; change or remove those blocks first`,
      ),
    );
  const remaining = plugins.value.filter((_, index) => index !== at);
  const memberCount = remaining.filter((decl) => idOf(decl) !== undefined).length;
  let nextOrchestration: RawDecl | undefined = orchestration.value;
  if (nextOrchestration !== undefined) {
    const members = membersOf(nextOrchestration);
    if (memberCount === 0) {
      // 남는 구성원이 없으면 목록을 지우고, 구성 선언도 없으면 orchestration 선언 자체를 지운다
      nextOrchestration =
        nextOrchestration["composition"] === undefined
          ? undefined
          : withKey(nextOrchestration, "members", undefined);
    } else if (members !== undefined) {
      nextOrchestration = withKey(
        nextOrchestration,
        "members",
        members.filter((member) => member !== op.id),
      );
    }
  }
  const manifest = withKey(
    withKey(state.manifest, "plugins", remaining),
    "orchestration",
    nextOrchestration,
  );
  // 코드 파일은 지우지 않는다. 남기고 호출자가 알린다
  const kept = state.files.has(op.id) ? [...state.kept, op.id] : state.kept;
  return ok({ ...state, manifest, kept });
}

function moveMember(
  state: State,
  op: Extract<MemberOp, { readonly kind: "move" }>,
): Result<State, DevkitError> {
  const plugins = pluginsIn(state.manifest);
  if (!plugins.ok) return plugins;
  const members = plugins.value.flatMap((decl) => {
    const id = idOf(decl);
    return id === undefined ? [] : [{ id, decl }];
  });
  const from = members.findIndex((member) => member.id === op.id);
  if (from < 0) return err(missing(state.manifest, op.id));
  if (!Number.isInteger(op.toIndex) || op.toIndex < 0 || op.toIndex >= members.length)
    return err(invalid(`toIndex ${op.toIndex} is out of range 0..${members.length - 1}`));

  const rest = members.filter((_, index) => index !== from);
  const picked = members.filter((_, index) => index === from);
  const reordered = [...rest.slice(0, op.toIndex), ...picked, ...rest.slice(op.toIndex)];
  // 뿌리의 위치는 그대로 두고, 구성원 자리에 새 순서의 선언을 차례로 채운다
  const queue = reordered.map((member) => member.decl);
  const next = plugins.value.map((decl) =>
    idOf(decl) === undefined ? decl : (queue.shift() ?? decl),
  );
  return ok({ ...state, manifest: withKey(state.manifest, "plugins", next) });
}

/** 플러그인 선언 목록. `plugins`가 없으면 §4.5.4의 루트 플러그인 하나다 */
function pluginsIn(manifest: RawManifest): Result<RawDecl[], DevkitError> {
  const raw: unknown = manifest["plugins"] ?? [ROOT_DECL];
  if (!Array.isArray(raw)) return err(invalid("plugins must be an array"));
  const decls = arrayOf(raw);
  if (!decls.every(isRecord)) return err(invalid("every plugins entry must be an object"));
  return ok(decls);
}

function orchestrationIn(manifest: RawManifest): Result<RawDecl | undefined, DevkitError> {
  const raw: unknown = manifest["orchestration"];
  if (raw === undefined) return ok(undefined);
  if (!isRecord(raw)) return err(invalid("orchestration must be an object"));
  if (raw["members"] !== undefined && !Array.isArray(raw["members"]))
    return err(invalid("orchestration.members must be an array"));
  return ok(raw);
}

/** 구성원 코드 파일의 상대 경로. id는 PluginIdSchema를 통과했으므로 안전하지만, 쓰기 전에 대상 폴더 밖 경로를 한 번 더 막는다 */
function memberPathOf(id: string): Result<string, DevkitError> {
  const path = `${MEMBERS_DIR}/${id}.ts`;
  return isSafeRelative(path) ? ok(path) : err(invalid(`member file path is unsafe: ${path}`));
}

function idOf(decl: RawDecl): string | undefined {
  const id = decl["id"];
  return typeof id === "string" ? id : undefined;
}

function layerOf(decl: RawDecl): ExtensionLayer | undefined {
  const parsed = parse(ExtensionLayerSchema, decl["layer"]);
  return parsed.ok ? parsed.value : undefined;
}

/** `orchestration.members`의 값. 호출 전에 `orchestrationIn`이 배열인지 확인한다 */
function membersOf(orchestration: RawDecl | undefined): unknown[] | undefined {
  const raw = orchestration?.["members"];
  return raw === undefined ? undefined : arrayOf(raw);
}

function blocksOf(orchestration: RawDecl | undefined): RawDecl[] {
  const composition = orchestration?.["composition"];
  if (!isRecord(composition)) return [];
  return arrayOf(composition["blocks"]).flatMap((block) => (isRecord(block) ? [block] : []));
}

function blockIdsFor(orchestration: RawDecl | undefined, id: string): string[] {
  return blocksOf(orchestration).flatMap((block) => {
    const blockId = block["id"];
    return block["plugin"] === id && typeof blockId === "string" ? [blockId] : [];
  });
}

/** 구성 선언의 `plugin` 참조와 구성원 목록을 새 id로 바꾼다 */
function renameRefs(orchestration: RawDecl, from: string, to: string): RawDecl {
  const members = membersOf(orchestration);
  const renamedMembers =
    members === undefined
      ? orchestration
      : withKey(
          orchestration,
          "members",
          members.map((member) => (member === from ? to : member)),
        );
  const composition = renamedMembers["composition"];
  if (!isRecord(composition) || !Array.isArray(composition["blocks"])) return renamedMembers;
  const blocks = arrayOf(composition["blocks"]).map((block) =>
    isRecord(block) && block["plugin"] === from ? withKey(block, "plugin", to) : block,
  );
  return withKey(renamedMembers, "composition", { ...composition, blocks });
}

function missing(manifest: RawManifest, id: string): DevkitError {
  return manifest["name"] === id
    ? invalid(`"${id}" is the root plugin, which is not a member and cannot be changed here`)
    : { kind: "not_found", message: `plugin "${id}" is not a member of this extension` };
}

/** 키의 자리를 지킨 채 값을 바꾼다. 값이 undefined면 키를 지운다(출력 키 순서를 보존한다) */
function withKey(object: RawDecl, key: string, value: unknown): RawDecl {
  if (value === undefined)
    return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
  return { ...object, [key]: value };
}
