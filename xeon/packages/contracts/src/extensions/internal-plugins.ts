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
  "host-dialog-area-bridge",
  "host-proposals-bridge",
  "cap-schedule",
] as const;
export type InternalPluginName = (typeof INTERNAL_PLUGIN_NAMES)[number];

const INTERNAL_NAME_SET: ReadonlySet<string> = new Set(INTERNAL_PLUGIN_NAMES);

export function isInternalPluginName(name: string): name is InternalPluginName {
  return INTERNAL_NAME_SET.has(name);
}

/** 내부 부품 텍스트의 두 칸 */
export type InternalPluginTextField = "name" | "purpose";

/** 클라이언트 카탈로그 키: `core-loop`의 이름은 `plugin.internal.coreLoop.name`, 하는 일은 `plugin.internal.coreLoop.purpose` */
export function internalPluginTextKey(name: string, field: InternalPluginTextField): string {
  const camel = name.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
  return `plugin.internal.${camel}.${field}`;
}
