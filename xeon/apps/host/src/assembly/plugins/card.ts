import { assertNever } from "@fresnel/contracts";
import type { JsonObject, JsonValue } from "@fresnel/contracts/conversation";
import {
  CARD_MCP_LAUNCH_LIMITS,
  HOOKS,
  HOOK_POSITIONS,
  internalPluginLayer,
  isOrchestrationExtension,
  pluginDeclsOf,
  SCRIPT_LIMITS,
  SCRIPT_ENV_SANDBOXED_USES,
  SCRIPT_ENV_USES,
  SCRIPT_USES,
  type CardHook,
  type CardMcpLaunch,
  type CardScript,
  type CostFigures,
  type HookName,
  type HookPositionRow,
  type ImportedHookOrigin,
  type InjectInventory,
  type ManifestScriptDecl,
  type PluginCard,
  type PluginEnforcement,
  type PluginOriginKind,
  type PluginUiDecl,
} from "@fresnel/contracts/extensions";
import { scriptEnvNamesOf } from "@fresnel/ext-host";
import { compareUtf8 } from "./content-hash.ts";
import { declaredCostOf } from "./declared-cost.ts";
import { singleSkillPurpose, type PluginFolder } from "./folder-reader.ts";

// 플러그인 카드(M5c §3.1, §4.5.5, §4.5.9). 읽은 폴더와 매니페스트에서 정적으로 계산한다.
// 코드는 실행하지 않는다. 호스트가 채우는 값(출처, 검토 상태, 사용처, 건강 상태)은 입력으로 받는다.

const ELLIPSIS = "…";

/**
 * 카드를 만드는 재료. 폴더 원본은 `PluginFolder`가 그대로 맞는다. 폴더 원본이 없는 플러그인(내장 패키지,
 * 로드된 레코드의 매니페스트만 있는 것)은 재료를 비운 `materials`로 같은 모양을 준다
 */
export type CardSubject = Pick<PluginFolder, "name" | "manifest" | "materials">;

interface PluginCardOrigin {
  readonly kind: PluginOriginKind;
  readonly projectId?: string;
}

export interface BuildCardInput {
  readonly folder: CardSubject;
  readonly origin: PluginCardOrigin;
  readonly review: PluginCard["review"];
  readonly usedBy: readonly string[];
  readonly health: PluginCard["health"];
  /** 실행 파일 위치 찾기(PATH 탐색, 실행하지 않는다). 환경 모드 스크립트의 카드 칸이 쓴다. 생략하면 엔진 프로세스의 PATH다 */
  readonly whichTool?: (name: string) => string | undefined;
  /** 참이면 환경 모드 스크립트의 권한을 샌드박스 안의 값(`SCRIPT_ENV_SANDBOXED_USES`)으로 싣는다(설정 `l0.sandbox.sandboxImportedHooks`). 생략하면 거짓: 사용자 권한 그대로(`SCRIPT_ENV_USES`) */
  readonly envSandboxed?: boolean;
  /** 참이면 설정 `l0.sandbox.narrowDrafts`가 켜져 있다. 코드가 있는 격리 플러그인의 카드에 `runs.narrowBeforeApproval`을 싣는다. 생략하면 거짓 */
  readonly narrowDrafts?: boolean;
  /**
   * 가져온 훅의 출처(가져오기 계획이 검토 항목에 기록한 값). 환경 모드 스크립트의 `origin`과 `originLabel`은 이 값에서만 나온다. 매니페스트에서는 읽지 않는다.
   * 없으면 `unknown`이다(프로젝트 폴더 출처의 플러그인은 `project`, 라벨 없음)
   */
  readonly importedHookOrigin?: ImportedHookOrigin;
}

type PositionRow = HookPositionRow["positions"][number];

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/** 훅 위치를 카드의 문자열로 적는다. 여러 자리에 서면 쉼표로 잇는다 */
function positionText(position: PositionRow): string {
  switch (position.kind) {
    case "block":
      return `${position.block}.${position.side}`;
    case "boundary":
      return `boundary.${position.boundary}`;
    case "event":
      return position.anchor === undefined
        ? "event"
        : `event.${position.anchor.block}.${position.anchor.side}`;
    case "internal":
      return "internal";
    default:
      return assertNever(position, "positionText");
  }
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 글자 수(UTF-16 단위)가 `max` 이내면 그대로, 넘으면 말줄임표를 붙여 `max` 이내로 자른다. 서로게이트 쌍은 쪼개지 않는다 */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const char of text) {
    if (out.length + char.length > max - 1) break;
    out += char;
  }
  return `${out}${ELLIPSIS}`;
}

/** 항목 목록을 상한까지만 싣는다. 넘으면 마지막 자리에 남은 수를 적어 잘렸다는 것을 보인다 */
function capList(items: readonly string[], max: number): string[] {
  if (items.length <= max) return [...items];
  const kept = items.slice(0, max - 1);
  return [...kept, `${ELLIPSIS}(+${items.length - kept.length})`];
}

/**
 * `args`. 없거나 null이면 빈 목록이다. 배열이면 문자열 항목은 그대로 두고 그 밖의 항목은 JSON 문자열로 적는다.
 * 배열이 아니면 값 하나로 적는다. 검토자에게 숨기지 않는 것이 목적이라 잘못된 모양도 버리지 않는다.
 */
function argsOf(value: JsonValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    return [clipText(JSON.stringify(value), CARD_MCP_LAUNCH_LIMITS.arg)];
  }
  const shown = value.map((item) =>
    clipText(typeof item === "string" ? item : JSON.stringify(item), CARD_MCP_LAUNCH_LIMITS.arg),
  );
  return capList(shown, CARD_MCP_LAUNCH_LIMITS.args);
}

/** `env`의 키 이름만 UTF-8 바이트 순으로 싣는다. 값은 싣지 않는다. 객체가 아니면 이름이 없다 */
function envNamesOf(value: JsonValue | undefined): string[] {
  if (!isJsonObject(value)) return [];
  const names = Object.keys(value)
    .toSorted(compareUtf8)
    .map((name) => clipText(name, CARD_MCP_LAUNCH_LIMITS.envName));
  return capList(names, CARD_MCP_LAUNCH_LIMITS.envNames);
}

/** `cwd`. 없거나 null이면 null이고, 문자열이 아니면 JSON 문자열로 적는다 */
function cwdOf(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return clipText(text, CARD_MCP_LAUNCH_LIMITS.cwd);
}

/**
 * stdio 서버 설정(`mcp.json` 항목의 raw 값)에서 승인하면 실행될 명령 줄을 뽑는다. 코드는 실행하지 않는다.
 * 설정이 객체가 아니거나 `command`가 빈 문자열이 아닌 문자열이 아니면 null이다(읽기 단계가 이미 거른다).
 * 환경 변수는 키 이름만 싣고 값은 읽지도 싣지도 않는다.
 */
export function launchOf(config: JsonValue): CardMcpLaunch | null {
  if (!isJsonObject(config)) return null;
  const command = config.command;
  if (typeof command !== "string" || command.length === 0) return null;
  return {
    command: clipText(command, CARD_MCP_LAUNCH_LIMITS.command),
    args: argsOf(config.args),
    envNames: envNamesOf(config.env),
    cwd: cwdOf(config.cwd),
  };
}

/** 명령 문자열의 첫 실행 단어. 앞의 `NAME=값` 접두는 건너뛴다. 셸 내장과 변수·경로로 시작하는 단어는 찾지 않는다(undefined) */
function firstToolOf(command: string): string | undefined {
  for (const word of command.trim().split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      // 대입의 값에 명령 치환이 있으면(`f=$(jq -r …)`) 첫 실행 파일은 그 안에 있다. 여기서는 찾지 않는다(`-r`을 도구로 잘못 꼽지 않는다)
      if (word.includes("$(") || word.includes("`")) return undefined;
      continue;
    }
    const bare = word.replace(/^[\u0022\u0027]+|[\u0022\u0027]+$/g, "");
    if (bare === "" || bare.startsWith("$") || bare.includes("/") || SHELL_WORDS.has(bare)) {
      return undefined;
    }
    return bare;
  }
  return undefined;
}

const SHELL_WORDS: ReadonlySet<string> = new Set([
  "cd",
  "echo",
  "test",
  "[",
  "export",
  "set",
  "if",
  "for",
  "while",
  "true",
  "false",
  ":",
  "exit",
  "read",
  "printf",
]);

/**
 * 환경 모드 칸(AGE-58 [제안]). 원문 명령, 찾아낸 첫 단어의 위치(PATH 탐색만, 실행하지 않는다), 참조 파일과 지문, 이 기기에 없는 실행 파일을 싣는다.
 * 버전의 근거 글은 가져오기 보고서가 갖고 있고 매니페스트에는 없어 카드는 비워 둔다. `origin`은 가져오기가 검토 항목에 기록한 훅 출처이고 매니페스트에서는 읽지 않는다. `fromProject`는 `origin`이 프로젝트이거나 플러그인이 프로젝트 폴더 출처일 때 참이다
 */
function envOf(
  decl: ManifestScriptDecl,
  source: ScriptSource,
  which: (name: string) => string | undefined,
): CardScript["env"] {
  const env = decl.env;
  if (env === undefined) return undefined;
  const tool = firstToolOf(env.command);
  const found = tool === undefined ? undefined : which(tool);
  return {
    command: clipText(env.command, ENV_COMMAND_CHARS),
    shell: env.shell,
    interpreter: found ?? null,
    refs: env.refs.slice(0, 16).map((ref) => ({ path: clipText(ref.path, 1024), hash: ref.hash })),
    refsKnown: env.refsKnown,
    missingTools: tool !== undefined && found === undefined ? [tool] : [],
    versionHints: [],
    origin: source.origin,
    originLabel: source.originLabel,
    fromProject: source.origin === "project" || source.pluginFromProject,
  };
}

/** 스크립트 칸이 쓰는 출처 재료. `origin`은 엔진이 기록한 값에서만 정한다 */
interface ScriptSource {
  readonly origin: "user" | "project" | "unknown";
  readonly originLabel: string | null;
  /** 플러그인 자체가 프로젝트 폴더 출처인가 */
  readonly pluginFromProject: boolean;
}

function scriptSourceOf(
  pluginFromProject: boolean,
  imported: ImportedHookOrigin | undefined,
): ScriptSource {
  if (imported !== undefined) {
    return {
      origin: imported.kind,
      originLabel: imported.kind === "project" ? imported.label : null,
      pluginFromProject,
    };
  }
  return {
    origin: pluginFromProject ? "project" : "unknown",
    originLabel: null,
    pluginFromProject,
  };
}

const ENV_COMMAND_CHARS = 4096;

/**
 * 매니페스트 스크립트 하나의 칸. 명령은 실행기 이름이고 첫 인자는 상대 `file`, 그 뒤가 `args`다. 환경 변수는 선언된 이름만
 * 정렬해 싣고 값은 싣지 않는다. 환경 모드가 아니면 실제로 넘어가는 이름만 `envNames`에 싣고 받지 못하는 이름은 `envNotPassed`에 싣는다. 작업 폴더는 없다.
 * 기한은 선언의 값이거나 기본값이다. 상한은 `CARD_MCP_LAUNCH_LIMITS`를 따르고 잘린 것은 말줄임표로 보인다
 */
function scriptOf(
  decl: ManifestScriptDecl,
  source: ScriptSource,
  which: (name: string) => string | undefined,
  envSandboxed: boolean,
): CardScript {
  const env = envOf(decl, source, which);
  const declared = unique(decl.envNames ?? []).toSorted(compareUtf8);
  // 환경 모드가 아니면 실행기가 넘기는 이름(허용 목록, 토큰·키 이름 제외)만 싣고, 선언했지만 받지 못하는 이름은 따로 싣는다 [결정: 2026-11-22, 사용자, AGE-63]
  const split = env === undefined ? scriptEnvNamesOf(declared) : undefined;
  const names = split === undefined ? declared : [...split.passed];
  const argv = [decl.file, ...(decl.args ?? [])];
  return {
    name: decl.name,
    launch: {
      command: clipText(decl.runner, CARD_MCP_LAUNCH_LIMITS.command),
      args: capList(
        argv.map((arg) => clipText(arg, CARD_MCP_LAUNCH_LIMITS.arg)),
        CARD_MCP_LAUNCH_LIMITS.args,
      ),
      envNames: capList(
        names.map((name) => clipText(name, CARD_MCP_LAUNCH_LIMITS.envName)),
        CARD_MCP_LAUNCH_LIMITS.envNames,
      ),
      cwd: null,
    },
    timeoutMs: decl.timeoutMs ?? SCRIPT_LIMITS.timeoutDefaultMs,
    uses:
      env === undefined ? SCRIPT_USES : envSandboxed ? SCRIPT_ENV_SANDBOXED_USES : SCRIPT_ENV_USES,
    ...(split === undefined || split.ignored.length === 0
      ? {}
      : {
          envNotPassed: capList(
            split.ignored.map((name) => clipText(name, CARD_MCP_LAUNCH_LIMITS.envName)),
            CARD_MCP_LAUNCH_LIMITS.envNames,
          ),
        }),
    ...(env === undefined ? {} : { env }),
  };
}

function injectOf(
  folder: CardSubject,
  source: ScriptSource,
  which: (name: string) => string | undefined,
  envSandboxed: boolean,
): InjectInventory | null {
  const { manifest, materials } = folder;
  const decls = pluginDeclsOf(manifest);
  const tools = (manifest.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
  const commands = unique([
    ...(manifest.commands ?? []).map((command) => command.name),
    ...materials.commands.map((command) => command.name),
  ]);
  // 제공(provides)의 id를 providers 칸에 적는다. 모델 제공자는 코드가 등록하므로 정적으로 알 수 없다 [제안]
  const providers = unique(decls.flatMap((decl) => (decl.provides ?? []).map((p) => p.id)));
  const replaces = unique(decls.flatMap((decl) => decl.replaces ?? []));
  const ui: PluginUiDecl[] = (manifest.ui?.items ?? []).map((item) => ({
    id: item.id,
    placement: item.placement,
    readsState: null,
    // 매니페스트는 모델에 보일지 적지 않는다. 가장 좁은 값을 쓴다 [제안]
    modelVisible: "none",
  }));
  const always = materials.instructions.map((item) => ({ path: item.path, bytes: item.bytes }));
  const skills = materials.skills.map((skill) => ({
    name: skill.name,
    path: skill.path,
    descriptionChars: skill.descriptionChars,
  }));
  // 승인하면 실행될 명령은 stdio만 있다. http 서버는 실행 줄이 없어 null이다
  const mcpServers = materials.mcpServers.map((server) => ({
    name: server.name,
    transport: server.transport,
    launch: server.transport === "stdio" ? launchOf(server.config) : null,
  }));
  const agents = unique(materials.agents.map((agent) => agent.name));
  // 승인하면 실행될 명령 줄. 부를 코드(`entry`)가 없으면 아무도 부르지 않으므로 실행되지 않는다(validate.ts)
  const scripts = (manifest.scripts ?? []).map((decl) =>
    scriptOf(decl, source, which, envSandboxed),
  );

  const empty =
    always.length === 0 &&
    skills.length === 0 &&
    tools.length === 0 &&
    mcpServers.length === 0 &&
    scripts.length === 0 &&
    agents.length === 0 &&
    commands.length === 0 &&
    providers.length === 0 &&
    replaces.length === 0 &&
    ui.length === 0;
  if (empty) return null;
  return {
    instructions: { always, skills },
    tools,
    mcpServers,
    agents,
    providers,
    commands,
    ui,
    replaces,
    scripts,
  };
}

function hookOf(folder: CardSubject): { readonly hooks: readonly CardHook[] } | null {
  const byName = new Map<HookName, CardHook>();
  for (const decl of pluginDeclsOf(folder.manifest)) {
    for (const name of decl.hooks) {
      if (byName.has(name)) continue;
      const row = HOOK_POSITIONS[name];
      byName.set(name, {
        name,
        fold: HOOKS[name].fold,
        position: row.positions.map(positionText).join(", "),
        powers: [...row.powers],
      });
    }
  }
  if (byName.size === 0) return null;
  return { hooks: [...byName.values()] };
}

/**
 * Drive 칸. 선언이 `drives: true`면 시작 Drive로 고를 수 있다고 적는다. 실제로 고르는 것은 프로필이다.
 * 명령 목록은 매니페스트가 정적으로 주지 않아 비운다 [제안]
 */
function driveOf(
  folder: CardSubject,
): { readonly start: boolean; readonly commands: readonly string[] } | null {
  const drives = pluginDeclsOf(folder.manifest).some((decl) => decl.drives === true);
  return drives ? { start: true, commands: [] } : null;
}

/**
 * 샌드박스 안에서 도는가. 저장소 패키지(builtin)만 엔진 안에서 돈다(§4.5.5, 엔진 설계 §3). 그 밖의 코드는 샌드박스 하나(열린 정책, 막는 것은 보호 셋)다
 * [결정: 2026-11-21, 사용자, AGE-63]
 */
function isolatedOf(kind: PluginOriginKind): boolean {
  switch (kind) {
    case "builtin":
      return false;
    case "bundled":
    case "user":
    case "project":
    case "managed":
      return true;
    default:
      return assertNever(kind, "isolatedOf");
  }
}

/**
 * 비용 칸(토큰 어림값, `textTokens` = 글자 수 / 4 올림). 프로필 미리 보기와 같은 계산(`declaredCostOf`)이다.
 * - always = 지침 파일 + 선언된 도구(이름, 설명). 인자 스키마와 MCP 서버가 내는 도구는 정적으로 알 수 없어 들어 있지 않다(턴 기록의 값보다 작을 수 있다)
 * - onDemand = 스킬마다 설명(색인 줄)과 본문
 * - drive = null. Drive 중에만 싣는 지침은 훅이 실행 중에 넣어 정적 근거가 없다(측정은 `profileCost.get`)
 * 코드 플러그인이 도구를 선언하지 않으면 도구 비용을 셀 수 없어 숫자는 null, basis는 unknown이다(프로필 미리 보기와 같다)
 */
function costOf(folder: CardSubject): CostFigures {
  const tools = folder.manifest.tools ?? [];
  if (folder.manifest.entry !== undefined && tools.length === 0) {
    return { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" };
  }
  const figures = declaredCostOf({
    tools,
    instructions: folder.materials.instructions.map((item) => item.text),
    skills: folder.materials.skills.map((skill) => ({
      description: skill.description ?? "",
      body: skill.body,
    })),
  });
  return {
    always: figures.always,
    drive: null,
    onDemand: figures.onDemand,
    toolCount: figures.toolCount,
    basis: "declared",
  };
}

/** 내부 부품 판정(F.extensions.spec §3.1.3): 출처가 내장이고 매니페스트에 `group` 블록이 없다. 대화마다 켜고 끌 수 있는 내장 그룹은 아니다 */
function isInternalCard(kind: PluginOriginKind, manifest: CardSubject["manifest"]): boolean {
  return kind === "builtin" && !isOrchestrationExtension(manifest);
}

/** 카드 한 장을 만든다. 코드는 실행하지 않는다 */
export function buildPluginCard(input: BuildCardInput): PluginCard {
  const { folder } = input;
  const { manifest, materials } = folder;
  const inject = injectOf(
    folder,
    scriptSourceOf(input.origin.kind === "project", input.importedHookOrigin),
    input.whichTool ?? ((name) => Bun.which(name) ?? undefined),
    input.envSandboxed === true,
  );
  const hook = hookOf(folder);
  const drive = driveOf(folder);
  const enforced = drive !== null || (hook?.hooks.some((item) => item.fold !== "tap") ?? false);
  const enforcement: PluginEnforcement = enforced ? "enforced" : "advisory";
  const code = manifest.entry !== undefined;
  const displayName = manifest.displayName?.trim() ?? "";
  const purpose = manifest.purpose ?? singleSkillPurpose(materials.skills);
  const projectId = input.origin.projectId;
  const internal = isInternalCard(input.origin.kind, manifest);
  const internalLayer = internal ? internalPluginLayer(manifest.name) : undefined;
  const origin =
    projectId === undefined ? { kind: input.origin.kind } : { kind: input.origin.kind, projectId };

  return {
    name: folder.name,
    displayName: displayName === "" ? folder.name : displayName,
    version: manifest.version,
    purpose,
    does: { inject, hook, drive },
    enforcement,
    runs: {
      code,
      isolated: code ? isolatedOf(input.origin.kind) : null,
      // 코드가 격리 프로세스로 돌거나, 환경 모드가 아닌 스크립트가 있으면 승인 전에 좁게 돈다(스크립트만 있는 플러그인도)
      ...(input.narrowDrafts === true &&
      ((code && isolatedOf(input.origin.kind)) ||
        (inject?.scripts ?? []).some((script) => script.env === undefined))
        ? { narrowBeforeApproval: true as const }
        : {}),
    },
    cost: costOf(folder),
    health: input.health,
    origin,
    internal,
    ...(internalLayer === undefined ? {} : { internalLayer }),
    review: input.review,
    usedBy: input.usedBy,
  };
}
