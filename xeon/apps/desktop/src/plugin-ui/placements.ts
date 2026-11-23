import { activeLocale, t } from "@fresnel/client/i18n";
import { stripUnsafeText } from "@fresnel/client/views/app";
import { extMessageOf } from "@fresnel/client/views/native";
import type { Placement } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { appsAllowed } from "./policy-context.ts";

// 화면 항목을 여섯 배치 자리(page, panel, card, status, command, settings)로 묶는다. 순수 함수이고 그리지 않는다.
// 상태 `disabled`·`invalid` 항목도 목록에 남기고 상태를 그대로 둔다(호스트가 자리표시를 그린다).
// 앱 모드 항목인데 앱 정책이 막으면 `frame_blocked`로 표시한다. 호스트는 `entry.tree`가 있으면 그것을, 없으면 자리표시를 그린다.
// 사용자가 숨긴 항목(`x.ui.hidden`)은 자리 목록에서 빠지고, 상태 표시줄 칸은 사용자가 정한 순서(`x.ui.order.status`)를 따른다
// [결정: 2026-11-23 사용자, AGE-73, ADR-0021 §3.12]. 숨긴 항목도 `PluginUiState.entries`에는 남는다(크래프트 "화면과 설정" 탭이 스위치를 그린다).

/** 사용자가 숨긴 항목 열쇠 목록과 자리별 순서(X.loading-trust.spec §6). 앱 전체에 한 벌이다 */
export const UI_HIDDEN_KEY = "x.ui.hidden";
export const UI_ORDER_KEY = "x.ui.order";

/** 사용자가 순서를 바꾸는 자리: 상태 표시줄 칸, 오른쪽 플러그인 패널의 화면 목록 */
const ORDERED_PLACES = ["status", "panel"] as const;
export type OrderedPlace = (typeof ORDERED_PLACES)[number];

/** 숨긴 항목과 자리별 순서. 열쇠는 `<확장>/<항목 id>`다 */
export interface UiLayout {
  readonly hidden: ReadonlySet<string>;
  readonly order: { readonly [P in OrderedPlace]: readonly string[] };
}

export const EMPTY_LAYOUT: UiLayout = { hidden: new Set(), order: { status: [], panel: [] } };

/** 항목 하나의 열쇠. 숨김과 순서 값이 이 글을 담는다 */
export function itemKeyOf(entry: Pick<ExtUiEntry, "extension" | "id">): string {
  return `${entry.extension}/${entry.id}`;
}

function stringsOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** 설정 값에서 숨김과 순서를 읽는다. 모양이 틀린 값은 비어 있는 것으로 본다(엔진이 스키마로 거르지만 화면도 믿지 않는다) */
export function layoutOf(settings: Readonly<Record<string, unknown>>): UiLayout {
  const order = settings[UI_ORDER_KEY];
  const record = typeof order === "object" && order !== null && !Array.isArray(order) ? order : {};
  return {
    hidden: new Set(stringsOf(settings[UI_HIDDEN_KEY])),
    order: {
      status: stringsOf("status" in record ? record.status : undefined),
      panel: stringsOf("panel" in record ? record.panel : undefined),
    },
  };
}

/** 저장할 설정 값 둘. 숨김은 이름순, 순서는 빈 자리를 뺀다 */
export function layoutValuesOf(layout: UiLayout): {
  readonly hidden: readonly string[];
  readonly order: { readonly status?: readonly string[]; readonly panel?: readonly string[] };
} {
  return {
    hidden: [...layout.hidden].toSorted(),
    order: {
      ...(layout.order.status.length === 0 ? {} : { status: layout.order.status }),
      ...(layout.order.panel.length === 0 ? {} : { panel: layout.order.panel }),
    },
  };
}

/** 사용자가 숨길 수 있는 자리인가. 설정 구역(`settings`)은 숨기는 대상이 아니다 */
function isHideable(entry: Pick<ExtUiEntry, "placement">): boolean {
  return entry.placement !== "settings";
}

/** 사용자가 이 항목을 숨겼는가 */
export function isHidden(layout: UiLayout, entry: ExtUiEntry): boolean {
  return isHideable(entry) && layout.hidden.has(itemKeyOf(entry));
}

/**
 * 순서 목록을 따라 줄 세운다. 목록에 있는 항목이 그 순서로 앞에 오고, 없는 항목은 그 뒤에 들어온 순서 그대로다(안정 정렬).
 * 목록의 모르는 열쇠(지운 플러그인)는 무시한다
 */
export function orderedBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  order: readonly string[],
): readonly T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((key, index): [string, number] => [key, index]));
  const last = order.length;
  return items.toSorted(
    (left, right) => (rank.get(keyOf(left)) ?? last) - (rank.get(keyOf(right)) ?? last),
  );
}

/**
 * 열쇠 목록에서 `key`를 `delta`만큼 옮긴 새 목록. 끝을 넘거나 열쇠가 없으면 null이다(메뉴의 "위로", "아래로"가 꺼진다)
 */
export function movedKeys(
  keys: readonly string[],
  key: string,
  delta: -1 | 1,
): readonly string[] | null {
  const at = keys.indexOf(key);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= keys.length) return null;
  const next = [...keys];
  next.splice(at, 1);
  next.splice(to, 0, key);
  return next;
}

export interface PlacedEntry {
  readonly entry: ExtUiEntry;
  /** 앱 정책이 막아 틀을 그릴 수 없는 항목이면 `frame_blocked`, 아니면 null */
  readonly blocked: "frame_blocked" | null;
}

export type PlacementGroups = { readonly [P in Placement]: readonly PlacedEntry[] };

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function blockedOf(
  entry: ExtUiEntry,
  settings: Readonly<Record<string, unknown>>,
): "frame_blocked" | null {
  return entry.mode === "app" && !appsAllowed(entry.trust, settings) ? "frame_blocked" : null;
}

/** 기본 순서: 확장 이름, 화면 id 순(`toSorted`는 안정 정렬이라 같은 쌍은 입력 순서를 지킨다) */
export function sortedEntries(entries: readonly ExtUiEntry[]): readonly ExtUiEntry[] {
  return entries.toSorted(
    (left, right) => compareText(left.extension, right.extension) || compareText(left.id, right.id),
  );
}

/**
 * 항목을 배치별로 묶는다. 같은 배치 안은 확장 이름, 화면 id 순이고 상태 표시줄 칸은 사용자 순서(`x.ui.order.status`)가 앞선다.
 * 사용자가 숨긴 항목(`x.ui.hidden`)은 빠진다. `settings`는 `x.ui.*` 값을 담은 객체다(`appsAllowed`와 `layoutOf`가 읽는다)
 */
export function groupPlacements(
  entries: readonly ExtUiEntry[],
  settings: Readonly<Record<string, unknown>>,
): PlacementGroups {
  const layout = layoutOf(settings);
  const placed: readonly PlacedEntry[] = sortedEntries(entries)
    .filter((entry) => !isHidden(layout, entry))
    .map((entry) => ({ entry, blocked: blockedOf(entry, settings) }));
  const at = (placement: Placement): readonly PlacedEntry[] =>
    placed.filter((item) => item.entry.placement === placement);
  return {
    page: at("page"),
    panel: at("panel"),
    card: at("card"),
    status: orderedBy(at("status"), (item) => itemKeyOf(item.entry), layout.order.status),
    command: at("command"),
    settings: at("settings"),
  };
}

/**
 * 상태 표시줄 칸 자리의 지금 순서(숨긴 칸 포함). "위로", "아래로"가 이 목록에서 옮기고 그 결과를 통째로 저장한다
 */
export function statusOrderKeysOf(
  entries: readonly ExtUiEntry[],
  layout: UiLayout,
): readonly string[] {
  return orderedBy(
    sortedEntries(entries.filter((entry) => entry.placement === "status")),
    itemKeyOf,
    layout.order.status,
  ).map(itemKeyOf);
}

/**
 * 상태 표시줄 칸이나 설정 구역에 그릴 선언형 항목. 상태가 `ok`이고 선언형이며 트리가 있고, 확장이 꺼졌거나 안전 모드로 빠지지 않은 것만 준다.
 * `inactive`는 `PluginUiState.inactive`다. 앱 항목과 그 밖의 항목은 여기서 빠진다
 */
export function nativeEntriesOf(
  items: readonly PlacedEntry[],
  inactive: ReadonlySet<string>,
): readonly ExtUiEntry[] {
  return items
    .map((item) => item.entry)
    .filter(
      (entry) =>
        entry.state === "ok" &&
        entry.mode === "native" &&
        entry.tree !== undefined &&
        !inactive.has(entry.extension),
    );
}

/**
 * 팔레트 명령 자리(`command`)의 항목 가운데 실행할 수 있는 것: 상태가 `ok`이고 확장이 꺼지지 않은 것.
 * 명령 항목에는 트리가 없고 `when`도 wire에 없어 열린 대화를 요구하는 것은 팔레트가 정한다
 */
export function commandEntriesOf(
  items: readonly PlacedEntry[],
  inactive: ReadonlySet<string>,
): readonly ExtUiEntry[] {
  return items
    .map((item) => item.entry)
    .filter((entry) => entry.state === "ok" && !inactive.has(entry.extension));
}

/**
 * 확장이 낸 글 하나의 표시 이름: `<확장> · <제목>`. 제목이 메시지 키면 현재 로케일 문구로 푼다(ADR-0021 §3.8). 제목은 방향 제어 글자와 제어 문자를 뺀다. 제목이 비면 화면 id를 쓴다.
 * 확장 이름이 앞에 와서 셸의 행동 이름으로 읽히지 않는다(보고 2, 3)
 */
export function originTitleOf(entry: ExtUiEntry): string {
  const title = stripUnsafeText(
    extMessageOf(entry.messages, activeLocale(), entry.title),
    false,
  ).trim();
  return t("desktop.plugin.originTitle", {
    extension: entry.extension,
    title: title === "" ? entry.id : title,
  });
}

/**
 * 확장이 이 kind의 주인인가: 자기 `x.<이름>.` 접두이거나 내장 그룹의 `grp.<이름>.` 접두다. 호스트가 주인이 아닌 카드를 막지만,
 * 여기서도 주인을 먼저 고른다(보고 1)
 */
function ownsKind(extension: string, kind: string): boolean {
  return kind.startsWith(`x.${extension}.`) || kind.startsWith(`grp.${extension}.`);
}

/**
 * 레코드 종류(`kind`)에 맞는 `card` 항목 하나. `nativeEntriesOf`와 같은 조건(상태 `ok`, 선언형, 트리 있음, 꺼지지 않음)을 거친다.
 * 여럿이면 kind의 주인인 확장의 카드를 앞에 두고, 그다음은 자리 목록의 앞 것이다(확장 이름, 화면 id 순). 기록 하나에 카드 하나만 그린다
 */
export function cardOf(
  items: readonly PlacedEntry[],
  inactive: ReadonlySet<string>,
  kind: string,
): ExtUiEntry | undefined {
  const matches = nativeEntriesOf(items, inactive).filter((entry) => entry.forKind === kind);
  return matches.find((entry) => ownsKind(entry.extension, kind)) ?? matches[0];
}

/**
 * 이 kind의 카드를 사용자가 숨겼는가: 그릴 수 있는(`nativeEntriesOf` 조건) 카드가 이 kind에 있는데 모두 숨겼다.
 * 참이면 기록 줄은 아무것도 그리지 않는다(일반 item 글로도 그리지 않는다, ADR-0021 §3.12). 보이는 카드가 하나라도 있으면 거짓이다
 */
export function cardHiddenFor(
  entries: readonly ExtUiEntry[],
  inactive: ReadonlySet<string>,
  layout: UiLayout,
  kind: string,
): boolean {
  const cards = entries.filter(
    (entry) =>
      entry.placement === "card" &&
      entry.forKind === kind &&
      entry.state === "ok" &&
      entry.mode === "native" &&
      entry.tree !== undefined &&
      !inactive.has(entry.extension),
  );
  return cards.length > 0 && cards.every((entry) => isHidden(layout, entry));
}

/**
 * 카드 아래 출처 줄(DP-33). `forKind`가 `grp.<그룹>.`이고 그 그룹이 카드를 낸 확장 자신일 때만 `grp:<그룹>`이다.
 * 그 밖은 실제 확장이므로 `ext:<확장>`이다(다른 확장이 그룹 kind에 건 카드가 그룹의 출처로 보이지 않게 한다).
 * 와이어 항목과 `forKind`만 보고 기록의 내용(payload)은 보지 않는다
 */
export function provenanceOf(entry: ExtUiEntry): string {
  const group = /^grp\.([^.]+)\./.exec(entry.forKind ?? "")?.[1];
  return group !== undefined && group === entry.extension
    ? `grp:${group}`
    : `ext:${entry.extension}`;
}
