// 플러그인 상세와 목록의 "준비 상태"(AGE-76 질문 2 "Tool type plugin", plugWire). 원천은 엔진 카드(`plugin.list`)의 두 칸이다:
// 도구 플러그인의 `externalTool`(선언과 엔진이 점검한 `status`)과, 다른 플러그인의 `dependencies.dependsOn`(도구 플러그인을 가리키는 의존).
// 도구 플러그인은 자기 도구 한 줄, 도구에 기대는 플러그인(예: `cap-workspace` → `tool-rg` hard, `tool-git` soft)은 기대는 도구마다 한 줄이다.
// 엔진 계약은 바꾸지 않고 화면 쪽에서 모은다. 앱은 설치 명령을 돌리지 않는다(설치 안내는 글과 복사뿐이다).
import type { Locale } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { CardExternalTool, PluginCard } from "@fresnel/contracts/extensions";

/**
 * 도구 한 줄의 상태. 엔진 `ExternalToolStatus.kind`를 화면 이름으로 옮긴 것과, 점검 값이 아직 없는 `unchecked`다.
 * `ready` 시스템에서 찾음, `bundled` 앱에 들어 있는 것을 씀, `missing` 없음, `tooOld` 버전이 낮음, `unusable` 찾았지만 쓸 수 없음
 */
export const TOOL_NEED_STATES = [
  "ready",
  "bundled",
  "missing",
  "tooOld",
  "unusable",
  "unchecked",
] as const;
export type ToolNeedState = (typeof TOOL_NEED_STATES)[number];

export interface ToolNeedVM {
  /** 도구 플러그인 이름(예: "tool-git") */
  readonly plugin: string;
  /** 실행 파일 이름(예: "git") */
  readonly tool: string;
  readonly state: ToolNeedState;
  /** 없으면 플러그인이 돌지 않는가(hard 의존, 또는 도구 플러그인 자신). 거짓이면 "선택" */
  readonly required: boolean;
  /** 필요한 최소 버전. 없으면 어느 버전이든 된다 */
  readonly minVersion: string | null;
  /** 찾은 버전. 못 찾았거나 점검 전이면 null */
  readonly foundVersion: string | null;
  /** 화면 언어의 설치 안내 한 줄(복사 단추가 복사하는 글). 앱이 대신 설치하지 않는다 */
  readonly install: string;
}

export interface ToolReadinessVM {
  readonly needs: readonly ToolNeedVM[];
}

/** 카드의 도구 칸을 도구 한 줄로 옮긴다 */
export function toolNeedOf(
  plugin: string,
  tool: CardExternalTool,
  required: boolean,
  locale: Locale,
): ToolNeedVM {
  const base = {
    plugin,
    tool: tool.binary,
    required,
    minVersion: tool.minVersion ?? null,
    install: tool.install[locale],
  };
  const status = tool.status;
  if (status === undefined) {
    return { ...base, state: "unchecked", foundVersion: null };
  }
  switch (status.kind) {
    case "ready":
      return { ...base, state: "ready", foundVersion: status.version };
    case "bundled":
      return { ...base, state: "bundled", foundVersion: status.version };
    case "missing":
      return { ...base, state: "missing", foundVersion: null };
    case "too_old":
      return {
        ...base,
        state: "tooOld",
        minVersion: status.required,
        foundVersion: status.found,
      };
    case "unusable":
      return { ...base, state: "unusable", foundVersion: null };
    default:
      return assertNever(status, "ExternalToolStatus");
  }
}

/** 의존 대상(`이름` 또는 `이름/id`)의 플러그인 이름 */
function targetPluginOf(target: string): string {
  return target.split("/")[0] ?? target;
}

/**
 * 카드의 준비 상태. 도구 플러그인이면 자기 도구 한 줄(늘 필수)이고, 아니면 의존에 든 도구 플러그인마다 한 줄이다(hard는 필수, soft는 선택).
 * 같은 도구 플러그인을 여러 멤버가 가리키면 한 줄로 모으고 hard가 이긴다. 도구가 하나도 없으면 null이다(화면은 구역을 그리지 않는다)
 */
export function toolReadinessOf(
  card: PluginCard,
  cardOf: (name: string) => PluginCard | null,
  locale: Locale,
): ToolReadinessVM | null {
  if (card.externalTool !== undefined) {
    return { needs: [toolNeedOf(card.name, card.externalTool, true, locale)] };
  }
  const order: string[] = [];
  const required = new Map<string, boolean>();
  for (const dependency of card.dependencies?.dependsOn ?? []) {
    const name = targetPluginOf(dependency.target);
    if (name === card.name) continue;
    if (!required.has(name)) order.push(name);
    required.set(name, (required.get(name) ?? false) || dependency.kind === "hard");
  }
  const needs = order.flatMap((name) => {
    const tool = cardOf(name)?.externalTool;
    return tool === undefined ? [] : [toolNeedOf(name, tool, required.get(name) ?? false, locale)];
  });
  return needs.length === 0 ? null : { needs };
}

/** 없거나 버전이 낮거나 쓸 수 없는 도구인가. 이런 줄은 숨기지 않고 경고로 늘 보인다 */
export function needsAttentionOf(need: Pick<ToolNeedVM, "state">): boolean {
  return need.state === "missing" || need.state === "tooOld" || need.state === "unusable";
}

/** 꼭 필요한 도구가 없거나 버전이 낮거나 쓸 수 없는가. 목록과 상세 머리의 상태 칸이 "준비 안 됨"을 보인다 */
export function readinessBlocked(readiness: ToolReadinessVM | null): boolean {
  return (
    readiness !== null && readiness.needs.some((need) => need.required && needsAttentionOf(need))
  );
}
