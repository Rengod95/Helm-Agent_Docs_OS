import { assertNever } from "@fresnel/contracts";
import {
  HOOKS,
  HOOK_POSITIONS,
  pluginDeclsOf,
  type CardHook,
  type CostFigures,
  type HookName,
  type HookPositionRow,
  type InjectInventory,
  type PluginCard,
  type PluginEnforcement,
  type PluginOriginKind,
  type PluginUiDecl,
} from "@fresnel/contracts/extensions";
import { singleSkillPurpose, type PluginFolder } from "./folder-reader.ts";

// 플러그인 카드(M5c §3.1, §4.5.5, §4.5.9). 읽은 폴더와 매니페스트에서 정적으로 계산한다.
// 코드는 실행하지 않는다. 호스트가 채우는 값(출처, 검토 상태, 사용처, 건강 상태)은 입력으로 받는다.

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
  const mcpServers = materials.mcpServers.map((server) => ({
    name: server.name,
    transport: server.transport,
  }));
  const agents = unique(materials.agents.map((agent) => agent.name));

  const empty =
    always.length === 0 &&
    skills.length === 0 &&
    tools.length === 0 &&
    mcpServers.length === 0 &&
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
    purpose,
    does: { inject, hook, drive },
    enforcement,
    runs: { code, isolated: code ? isolatedOf(input.origin.kind) : null },
    cost: costOf(folder, manifest.tools?.length ?? 0),
    health: input.health,
    origin,
    review: input.review,
    usedBy: input.usedBy,
  };
}
