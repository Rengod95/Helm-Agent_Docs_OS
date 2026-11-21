// F.extensions.spec §3.1.3 내부 부품. 엔진이 스스로 싣는 플러그인 가운데 사용자가 켜고 끌 수 없는 것의 이름 목록과, 화면 표시용
// 이름·하는 일을 담는 클라이언트 카탈로그 키의 규칙이다. 이름과 하는 일은 모델 컨텍스트에 실리지 않는다(화면 표시 전용).

/** 내부 부품의 매니페스트 이름. 카드의 `internal`이 참인 것과 같은 집합이다(호스트 시험이 실제 엔진의 목록과 맞춘다) */
export const INTERNAL_PLUGIN_NAMES = [
  "core-persistence",
  "core-tasks",
  "core-models",
  "core-context",
  "core-tools",
  "core-loop",
  "host-groups",
  "core-agents",
  "cap-workspace",
  "cap-dialog",
  "cap-artifacts",
  "host-dialog-bridge",
  "cap-work",
  "cap-mcp",
  "cap-web",
  "cap-knowledge",
  "host-goal-bridge",
  "host-task-bridge",
  "host-skill-bridge",
  "host-memory-bridge",
  "host-proposals-bridge",
  "cap-schedule",
] as const;
export type InternalPluginName = (typeof INTERNAL_PLUGIN_NAMES)[number];

const INTERNAL_NAME_SET: ReadonlySet<string> = new Set(INTERNAL_PLUGIN_NAMES);

export function isInternalPluginName(name: string): name is InternalPluginName {
  return INTERNAL_NAME_SET.has(name);
}

/**
 * 내부 부품의 층 값(목록 화면이 코어와 기능으로 나눠 보이는 데 쓴다) [결정: 2026-11-20, 사용자, AGE-33]. 값 이름은 [제안].
 * `core`는 에이전트가 돌아가는 데 필요한 L1 코어, `capability`는 에이전트에게 도구와 기능을 주는 L2 기능, `bridge`는 기능을 앱에 이어 주는 호스트 조립 부품이다.
 * 브릿지를 기능과 같은 묶음으로 보일지 따로 보일지는 화면이 정한다(두 묶음으로 보이려면 `bridge`를 `capability`와 합치면 된다)
 */
export const INTERNAL_PLUGIN_LAYERS = ["core", "capability", "bridge"] as const;
export type InternalPluginLayer = (typeof INTERNAL_PLUGIN_LAYERS)[number];

const INTERNAL_LAYER_OF: Readonly<Record<InternalPluginName, InternalPluginLayer>> = {
  "core-persistence": "core",
  "core-tasks": "core",
  "core-models": "core",
  "core-context": "core",
  "core-tools": "core",
  "core-loop": "core",
  "host-groups": "bridge",
  "core-agents": "core",
  "cap-workspace": "capability",
  "cap-dialog": "capability",
  "cap-artifacts": "capability",
  "host-dialog-bridge": "bridge",
  "cap-work": "capability",
  "cap-mcp": "capability",
  "cap-web": "capability",
  "cap-knowledge": "capability",
  "host-goal-bridge": "bridge",
  "host-task-bridge": "bridge",
  "host-skill-bridge": "bridge",
  "host-memory-bridge": "bridge",
  "host-proposals-bridge": "bridge",
  "cap-schedule": "capability",
};

/** 내부 부품 이름의 층 값. 내부 부품이 아닌 이름은 `undefined`다 */
export function internalPluginLayer(name: string): InternalPluginLayer | undefined {
  return isInternalPluginName(name) ? INTERNAL_LAYER_OF[name] : undefined;
}

/** 층 묶음의 표시 이름 카탈로그 키: `plugin.internal.layer.core`, `.capability`, `.bridge` */
export function internalLayerTextKey(layer: InternalPluginLayer): string {
  return `plugin.internal.layer.${layer}`;
}

/** 내부 부품 텍스트의 두 칸 */
export type InternalPluginTextField = "name" | "purpose";

/** 클라이언트 카탈로그 키: `core-loop`의 이름은 `plugin.internal.coreLoop.name`, 하는 일은 `plugin.internal.coreLoop.purpose` */
export function internalPluginTextKey(name: string, field: InternalPluginTextField): string {
  const camel = name.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
  return `plugin.internal.${camel}.${field}`;
}
