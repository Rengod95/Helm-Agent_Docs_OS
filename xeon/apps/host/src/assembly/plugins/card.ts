import { assertNever } from "@fresnel/contracts";
import type { JsonObject, JsonValue } from "@fresnel/contracts/conversation";
import {
  CARD_MCP_LAUNCH_LIMITS,
  HOOKS,
  HOOK_POSITIONS,
  isGroupExtension,
  pluginDeclsOf,
  SCRIPT_LIMITS,
  SCRIPT_USES,
  type CardHook,
  type CardMcpLaunch,
  type CardScript,
  type CostFigures,
  type HookName,
  type HookPositionRow,
  type InjectInventory,
  type ManifestScriptDecl,
  type PluginCard,
  type PluginEnforcement,
  type PluginOriginKind,
  type PluginUiDecl,
} from "@fresnel/contracts/extensions";
import { compareUtf8 } from "./content-hash.ts";
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

/**
 * 매니페스트 스크립트 하나의 칸. 명령은 실행기 이름이고 첫 인자는 상대 `file`, 그 뒤가 `args`다. 환경 변수는 선언된 이름만
 * 정렬해 싣고 값은 싣지 않는다(거부 패턴에 걸리는 이름도 선언대로 싣는다. 실제로 넘기는 것은 실행기가 거른다). 작업 폴더는 없다.
 * 기한은 선언의 값이거나 기본값이다. 상한은 `CARD_MCP_LAUNCH_LIMITS`를 따르고 잘린 것은 말줄임표로 보인다
 */
function scriptOf(decl: ManifestScriptDecl): CardScript {
  const names = unique(decl.envNames ?? []).toSorted(compareUtf8);
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
    uses: SCRIPT_USES,
  };
}

function injectOf(folder: CardSubject): InjectInventory | null {
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
  const scripts = (manifest.scripts ?? []).map(scriptOf);

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

/** 격리 여부. 저장소 패키지(builtin)만 엔진 안에서 돈다(§4.5.5, 엔진 설계 §3) */
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

/** 비용 칸. 지침 글자 수의 단순 합(토큰 환산 전)이다. 스킬 본문과 명령 본문은 읽지 않으므로 null이다 */
function costOf(folder: CardSubject, toolCount: number): CostFigures {
  const alwaysChars = folder.materials.instructions.reduce(
    (sum, item) => sum + Array.from(item.text).length,
    0,
  );
  return {
    always: alwaysChars,
    drive: null,
    onDemand: null,
    toolCount,
    basis: "declared",
  };
}

/** 내부 부품 판정(F.extensions.spec §3.1.3): 출처가 내장이고 매니페스트에 `group` 블록이 없다. 대화마다 켜고 끌 수 있는 내장 그룹은 아니다 */
function isInternalCard(kind: PluginOriginKind, manifest: CardSubject["manifest"]): boolean {
  return kind === "builtin" && !isGroupExtension(manifest);
}

/** 카드 한 장을 만든다. 코드는 실행하지 않는다 */
export function buildPluginCard(input: BuildCardInput): PluginCard {
  const { folder } = input;
  const { manifest, materials } = folder;
  const inject = injectOf(folder);
  const hook = hookOf(folder);
  const drive = driveOf(folder);
  const enforced = drive !== null || (hook?.hooks.some((item) => item.fold !== "tap") ?? false);
  const enforcement: PluginEnforcement = enforced ? "enforced" : "advisory";
  const code = manifest.entry !== undefined;
  const displayName = manifest.displayName?.trim() ?? "";
  const purpose = manifest.purpose ?? singleSkillPurpose(materials.skills);
  const projectId = input.origin.projectId;
  const origin =
    projectId === undefined ? { kind: input.origin.kind } : { kind: input.origin.kind, projectId };

  return {
    name: folder.name,
    displayName: displayName === "" ? folder.name : displayName,
    version: manifest.version,
    purpose,
    does: { inject, hook, drive },
    enforcement,
    runs: { code, isolated: code ? isolatedOf(input.origin.kind) : null },
    cost: costOf(folder, manifest.tools?.length ?? 0),
    health: input.health,
    origin,
    internal: isInternalCard(input.origin.kind, manifest),
    review: input.review,
    usedBy: input.usedBy,
  };
}
