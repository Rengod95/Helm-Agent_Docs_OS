import {
  HOOK_NAMES,
  HOOKS,
  PLACEMENTS,
  type BridgeCapability,
  type HookKind,
  type HookPower,
  type Placement,
  type PluginCard,
  type UiMode,
} from "@fresnel/contracts/extensions";
import { placesOf, type Place } from "./review-model.ts";

// 리뷰 상세 "작동 방식"의 네 줄(시점 / 입력 / 영향 / 출력) [결정: 2026-11-20 사용자, AGE-33]. 캔버스 상세 패널(cv4 `facts.ts`)과 같은 말과
// 같은 규칙이다: 내부 이름(Hook 이름 `tool.call.before`, 기능 id)은 싣지 않고 사람이 읽는 자리 말과 사람이 고르거나 적는 이름(도구,
// MCP 서버, 명령, 에이전트, 스킬, 환경 변수)만 값으로 남긴다. 값은 리뷰 항목의 카드(`PluginCard`)와 계약의 Hook 표(`HOOKS`)에서만 온다.
// 캔버스는 프로필의 배치(같은 자리 순서, 핸드오프)를 알지만 리뷰 카드는 모른다: 그 말은 이 넷에 없다.

export type WhenFact =
  | { readonly kind: "place"; readonly place: Place }
  | { readonly kind: "start" }
  | { readonly kind: "command"; readonly value: string }
  | { readonly kind: "handoff" }
  | { readonly kind: "toolCall" }
  | { readonly kind: "everyRequest" }
  | { readonly kind: "onDemand" };

export type ReadsFact =
  | { readonly kind: "hook"; readonly hook: HookKind }
  | { readonly kind: "thread" }
  | { readonly kind: "toolArgs" }
  | { readonly kind: "env"; readonly value: string };

export type ChangesFact =
  | { readonly kind: "power"; readonly power: HookPower }
  | { readonly kind: "instructions" }
  | { readonly kind: "leads" }
  | { readonly kind: "replaces"; readonly value: string };

export type GivesFact =
  | { readonly kind: "tool"; readonly value: string }
  | { readonly kind: "server"; readonly value: string }
  | { readonly kind: "command"; readonly value: string }
  | { readonly kind: "agent"; readonly value: string }
  | { readonly kind: "skill"; readonly value: string }
  | { readonly kind: "ui"; readonly placement: Placement; readonly count: number }
  | { readonly kind: "decision" };

/**
 * 화면 줄 하나(작동 방식의 "화면" 줄이 쓸 값). 자리와 이름, 그리는 방식, 자체 코드의 까닭과 다리 권한을 매니페스트 선언 그대로 싣는다.
 * 옛 카드에는 방식이 없어 `mode`가 null이다. 선언형 화면은 까닭과 권한이 없다
 */
export interface ScreenFact {
  readonly id: string;
  readonly placement: string;
  readonly mode: UiMode | null;
  readonly reason: string | null;
  readonly capabilities: readonly BridgeCapability[];
}

export interface WorkFacts {
  readonly when: readonly WhenFact[];
  readonly reads: readonly ReadsFact[];
  readonly changes: readonly ChangesFact[];
  readonly gives: readonly GivesFact[];
  readonly screens: readonly ScreenFact[];
}

/** 카드의 Hook 이름이 계약이 아는 이름이면 그 종류(입력, 모델 요청, 도구 호출…). 모르는 이름은 null */
function hookKindOf(name: string): HookKind | null {
  const known = HOOK_NAMES.find((hook) => hook === name);
  return known === undefined ? null : HOOKS[known].kind;
}

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const POWER_ORDER: readonly HookPower[] = ["decide", "modify", "contribute", "observe"];

/** 카드의 자리 이름이 계약의 자리이면 그 자리, 아니면 null. 카드는 자리를 문자열로 든다 */
export function placementOf(name: string): Placement | null {
  return PLACEMENTS.find((placement) => placement === name) ?? null;
}

/** 네 줄의 값. 줄에 값이 없으면 빈 목록이고 화면은 그 줄을 그리지 않는다 */
export function workFactsOf(card: PluginCard): WorkFacts {
  const inject = card.does.inject;
  const hooks = card.does.hook?.hooks ?? [];
  const drive = card.does.drive;
  const tools = inject?.tools ?? [];
  const servers = inject?.mcpServers ?? [];
  const always = inject?.instructions.always ?? [];
  const skills = inject?.instructions.skills ?? [];

  const when: WhenFact[] = placesOf(card).map((place) => ({ kind: "place", place }));
  if (drive !== null) {
    if (drive.start) when.push({ kind: "start" });
    for (const command of drive.commands) when.push({ kind: "command", value: `/${command}` });
    if (!drive.start && drive.commands.length === 0) when.push({ kind: "handoff" });
  }
  if (tools.length > 0 || servers.length > 0) when.push({ kind: "toolCall" });
  if (always.length > 0) when.push({ kind: "everyRequest" });
  if (skills.length > 0) when.push({ kind: "onDemand" });

  const hookKinds = unique(
    hooks.flatMap((hook) => {
      const kind = hookKindOf(hook.name);
      return kind === null ? [] : [kind];
    }),
    (kind) => kind,
  );
  const envNames = unique(
    [
      ...(inject?.scripts ?? []).flatMap((script) => script.launch.envNames),
      ...servers.flatMap((server) => server.launch?.envNames ?? []),
    ],
    (name) => name,
  );
  const reads: ReadsFact[] = [
    ...hookKinds.map((hook): ReadsFact => ({ kind: "hook", hook })),
    ...(drive === null ? [] : [{ kind: "thread" } satisfies ReadsFact]),
    ...(tools.length > 0 || servers.length > 0 ? [{ kind: "toolArgs" } satisfies ReadsFact] : []),
    ...envNames.map((value): ReadsFact => ({ kind: "env", value })),
  ];

  const powers = new Set(hooks.flatMap((hook) => hook.powers));
  const changes: ChangesFact[] = [
    ...POWER_ORDER.filter((power) => powers.has(power)).map((power): ChangesFact => ({
      kind: "power",
      power,
    })),
    ...(always.length > 0 ? [{ kind: "instructions" } satisfies ChangesFact] : []),
    ...(drive === null ? [] : [{ kind: "leads" } satisfies ChangesFact]),
    ...(inject?.replaces ?? []).map((value): ChangesFact => ({ kind: "replaces", value })),
  ];

  const gives: GivesFact[] = [
    ...tools.map((tool): GivesFact => ({ kind: "tool", value: tool.name })),
    // 도구 목록이 비고 서버만 있으면 서버 이름을 보인다(서버의 도구는 연결해야 안다)
    ...(tools.length === 0
      ? servers.map((server): GivesFact => ({ kind: "server", value: server.name }))
      : []),
    ...(inject?.commands ?? []).map((value): GivesFact => ({
      kind: "command",
      value: `/${value}`,
    })),
    ...(inject?.agents ?? []).map((value): GivesFact => ({ kind: "agent", value })),
    ...skills.map((skill): GivesFact => ({ kind: "skill", value: skill.name })),
    // 화면은 자리마다 한 칩(자리 순서). 그 자리에 항목이 없으면 칩도 없다
    ...PLACEMENTS.flatMap((placement): GivesFact[] => {
      const count = (inject?.ui ?? []).filter((ui) => ui.placement === placement).length;
      return count === 0 ? [] : [{ kind: "ui", placement, count }];
    }),
    ...(powers.has("decide") ? [{ kind: "decision" } satisfies GivesFact] : []),
  ];
  const screens: ScreenFact[] = (inject?.ui ?? []).map((ui) => ({
    id: ui.id,
    placement: ui.placement,
    mode: ui.mode ?? null,
    reason: ui.app?.reason === undefined || ui.app.reason === "" ? null : ui.app.reason,
    capabilities: unique(ui.app?.capabilities ?? [], (capability) => capability),
  }));
  return { when, reads, changes, gives, screens };
}

// "이전 버전과 달라진 일"의 한 줄. 엔진의 차이(`apps/host` `plugins/diff.ts`)는 `what`을 `<부품>:<이름>` 열쇠로 준다(`tool:fetch`,
// `script:count`, `mcp:fetch`, `drive:command:plan`, `runs:code`…). 주입되는 것은 모두 `inject` 칸이라 칸 이름만으로는 무엇이 바뀌었는지
// 알 수 없다: 화면은 열쇠의 앞부분을 사람 말로 바꾸고 이름만 값으로 남긴다. 모르는 열쇠는 그대로 보인다.

const CHANGE_PARTS = [
  "instruction",
  "skill",
  "tool",
  "mcp",
  "script",
  "agent",
  "command",
  "provider",
  "ui",
  "replaces",
  "hook",
  "driveStart",
  "runsCode",
  "runsIsolated",
] as const;
export type ChangePart = (typeof CHANGE_PARTS)[number];

/** 바뀐 부품과 그 이름. `part`가 null이면 모르는 열쇠이고 `name`은 받은 그대로다 */
export interface ChangeWhat {
  readonly part: ChangePart | null;
  readonly name: string;
}

const WHOLE_KEYS: ReadonlyMap<string, ChangePart> = new Map([
  ["drive:start", "driveStart"],
  ["runs:code", "runsCode"],
  ["runs:isolated", "runsIsolated"],
]);

const PREFIX_PARTS: ReadonlyMap<string, ChangePart> = new Map([
  ["drive:command", "command"],
  ["instruction", "instruction"],
  ["skill", "skill"],
  ["tool", "tool"],
  ["mcp", "mcp"],
  ["script", "script"],
  ["agent", "agent"],
  ["command", "command"],
  ["provider", "provider"],
  ["ui", "ui"],
  ["replaces", "replaces"],
  ["hook", "hook"],
]);

export function changeWhatOf(what: string): ChangeWhat {
  const whole = WHOLE_KEYS.get(what);
  if (whole !== undefined) return { part: whole, name: "" };
  for (const [prefix, part] of PREFIX_PARTS) {
    if (what.startsWith(`${prefix}:`) && what.length > prefix.length + 1) {
      return { part, name: what.slice(prefix.length + 1) };
    }
  }
  return { part: null, name: what };
}
