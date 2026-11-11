import type { BridgeCapability } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import type { PlacedEntry } from "../../plugin-ui/placements.ts";
import type { PluginUiState } from "../../plugin-ui/runtime.ts";
import { pluginScreenItemsOf } from "./plugin-pick.ts";

// "추가 기능" 화면(ADR-0021 §3.11)의 목록과 상세 모델. 순수 함수이고 그리지 않는다. 제목 풀이는 호출하는 쪽이 `titleOf`로 준다.

/** 목록 행과 상세 머리가 보이는 문제 한 가지. 없으면 null이다. 위에 있을수록 먼저 보인다 */
export type AddonProblem = "off" | "blocked" | "invalid";

export interface AddonScreenRow {
  /** `<확장>/<화면 id>` */
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly mode: ExtUiEntry["mode"];
  readonly state: ExtUiEntry["state"];
  /** 확장이 꺼졌거나 안전 모드이거나 화면이 꺼진 화면 */
  readonly off: boolean;
  /** 앱 정책이 격리 프레임을 막은 화면 */
  readonly blocked: boolean;
  readonly issues: number;
}

/** 화면이 아닌 자리에 더한 것(카드, 상태 칸, 명령, 설정 구역) */
export type AddonExtraKind = "card" | "status" | "command" | "settings";

interface AddonExtraRow {
  readonly kind: AddonExtraKind;
  readonly id: string;
  readonly title: string;
}

export interface AddonCard {
  readonly extension: string;
  /** 표지에 쓰는 이름 첫 글자(대문자) */
  readonly initial: string;
  readonly version: string;
  readonly trust: ExtUiEntry["trust"];
  readonly screens: readonly AddonScreenRow[];
  /** 목록 한 줄 요약: 화면 제목을 ", "로 이은 것 */
  readonly summary: string;
  readonly extras: readonly AddonExtraRow[];
  /** 격리 화면들이 선언한 능력의 합집합(`BRIDGE_CAPABILITIES` 순서) */
  readonly capabilities: readonly BridgeCapability[];
  /** 격리 화면이 하나라도 있는가 */
  readonly hasFrame: boolean;
  readonly problem: AddonProblem | null;
  /** 진단 개수 합(화면과 더한 것 전부) */
  readonly issues: number;
}

const CAPABILITY_ORDER: readonly BridgeCapability[] = [
  "files",
  "notify",
  "settingsWrite",
  "secrets",
];
const EXTRA_KINDS: readonly AddonExtraKind[] = ["card", "status", "command", "settings"];

function extraKindOf(entry: ExtUiEntry): AddonExtraKind | null {
  return EXTRA_KINDS.find((kind) => kind === entry.placement) ?? null;
}

function screenRowOf(
  placed: PlacedEntry,
  inactive: ReadonlySet<string>,
  titleOf: (entry: ExtUiEntry) => string,
): AddonScreenRow {
  const { entry } = placed;
  return {
    key: `${entry.extension}/${entry.id}`,
    id: entry.id,
    title: titleOf(entry),
    mode: entry.mode,
    state: entry.state,
    off: entry.state === "disabled" || inactive.has(entry.extension),
    blocked: placed.blocked !== null,
    issues: entry.issues.length,
  };
}

function problemOf(screens: readonly AddonScreenRow[]): AddonProblem | null {
  if (screens.some((screen) => screen.state === "invalid")) return "invalid";
  if (screens.some((screen) => screen.blocked)) return "blocked";
  if (screens.length > 0 && screens.every((screen) => screen.off)) return "off";
  return null;
}

/**
 * 화면을 더한 플러그인마다 카드 하나. 화면은 `pluginScreenItemsOf`(page와 Helm이 아닌 panel)이고, 같은 확장의 다른 자리(card, status, command, settings)는 `extras`로 붙는다.
 * 확장 이름 순이다. 화면이 없는 확장은 목록에 없다
 */
export function addonCardsOf(
  state: PluginUiState,
  titleOf: (entry: ExtUiEntry) => string,
): readonly AddonCard[] {
  const screens = pluginScreenItemsOf(state);
  const names = [...new Set(screens.map(({ entry }) => entry.extension))].toSorted();
  const placedAll: readonly PlacedEntry[] = [
    ...state.groups.card,
    ...state.groups.status,
    ...state.groups.command,
    ...state.groups.settings,
  ];
  return names.map((extension) => {
    const own = screens.filter(({ entry }) => entry.extension === extension);
    const rows = own.map((placed) => screenRowOf(placed, state.inactive, titleOf));
    const extras = placedAll
      .filter(({ entry }) => entry.extension === extension)
      .flatMap(({ entry }): AddonExtraRow[] => {
        const kind = extraKindOf(entry);
        return kind === null ? [] : [{ kind, id: entry.id, title: titleOf(entry) }];
      });
    const declared = new Set(own.flatMap(({ entry }) => entry.app?.capabilities ?? []));
    const first = own[0]?.entry;
    return {
      extension,
      initial: extension.slice(0, 1).toUpperCase(),
      version: first?.version ?? "",
      trust: first?.trust ?? "user",
      screens: rows,
      summary: rows.map((row) => row.title).join(", "),
      extras,
      capabilities: CAPABILITY_ORDER.filter((name) => declared.has(name)),
      hasFrame: own.some(({ entry }) => entry.mode === "app"),
      problem: problemOf(rows),
      issues: [...own, ...placedAll.filter(({ entry }) => entry.extension === extension)].reduce(
        (sum, { entry }) => sum + entry.issues.length,
        0,
      ),
    };
  });
}

/** 열 수 있는 화면(꺼지지 않았고 막히지 않았고 유효한 것). 상세의 "열기"와 머리 단추가 쓴다 */
export function openableScreensOf(card: AddonCard): readonly AddonScreenRow[] {
  return card.screens.filter((screen) => !screen.off && !screen.blocked && screen.state === "ok");
}
