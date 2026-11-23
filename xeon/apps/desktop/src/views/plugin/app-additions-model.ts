import { stripUnsafeText } from "@fresnel/client/views/app";
import { extMessageOf } from "@fresnel/client/views/native";
import type { ExtUiEntry } from "@fresnel/contracts/wire";

// "플러그인이 더한 것"(AGE-78, AGE-73 제안 1)의 모델. 플레이그라운드 머리 단추가 연 팝오버가 그린다. 순수 함수이고 그리지 않는다.
// 자리는 플러그인이 앱 곳곳에 더한 것의 위치다. 탭은 고정된 플러그인 탭, 나머지는 `ext.ui.list` 항목의 `placement`다.
// 페이지와 설정 구역은 여기 넣지 않는다(화면과 설정은 플레이그라운드와 설정이 맡는다).

/** 더해진 자리. 순서는 이대로 고정이다(팝오버의 묶음 순서) */
export type AdditionPlace = "tab" | "panel" | "status" | "card" | "command";

/** 자리 하나 안의 플러그인 한 줄. `items`는 그 플러그인이 그 자리에 더한 항목의 제목들이다(탭은 빈 목록) */
interface AdditionRow {
  readonly plugin: string;
  readonly title: string;
  readonly items: readonly string[];
}

/** 줄이 하나 이상 있는 자리 하나 */
export interface AdditionGroup {
  readonly place: AdditionPlace;
  readonly rows: readonly AdditionRow[];
}

const PLACES: readonly AdditionPlace[] = ["tab", "panel", "status", "card", "command"];

/** 항목 제목: 화면 제목과 같은 방식으로 현재 로케일로 풀고 위험한 글자를 뺀다. 비면 항목 id */
function itemTitleOf(entry: ExtUiEntry, locale: string): string {
  const title = stripUnsafeText(extMessageOf(entry.messages, locale, entry.title), false).trim();
  return title === "" ? entry.id : title;
}

/** 플러그인 표시 이름(앞뒤 공백을 뺀다). 비면 플러그인 이름 */
function titleOf(plugin: string, titles: ReadonlyMap<string, string>): string {
  const shown = (titles.get(plugin) ?? "").trim();
  return shown === "" ? plugin : shown;
}

/** 고정 탭 줄: 고정 순서대로 플러그인마다 한 줄, 항목은 없다 */
function tabRowsOf(
  pinned: readonly string[],
  titles: ReadonlyMap<string, string>,
): readonly AdditionRow[] {
  return pinned.map((plugin) => ({ plugin, title: titleOf(plugin, titles), items: [] }));
}

/** 자리 하나의 줄: 플러그인별로 묶고(입력 순서를 지킨다), 줄은 표시 이름 순이다 */
function rowsOfPlace(
  place: AdditionPlace,
  entries: readonly ExtUiEntry[],
  titles: ReadonlyMap<string, string>,
  locale: string,
): readonly AdditionRow[] {
  const byPlugin = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.placement !== place) continue;
    const title = itemTitleOf(entry, locale);
    const items = byPlugin.get(entry.extension);
    if (items === undefined) byPlugin.set(entry.extension, [title]);
    else items.push(title);
  }
  return [...byPlugin]
    .map(([plugin, items]) => ({ plugin, title: titleOf(plugin, titles), items }))
    .toSorted(
      (left, right) =>
        left.title.localeCompare(right.title) || left.plugin.localeCompare(right.plugin),
    );
}

/**
 * 자리별 더해진 것. 고정 탭 줄(`pinned` 순서), 대화 옆 패널·상태 칸·대화 카드·명령(항목을 플러그인별로 묶고 항목 순서를 지킨다).
 * 줄이 없는 자리는 뺀다. `titles`에 없거나 빈 이름은 플러그인 이름을 쓴다
 */
export function additionsOf(input: {
  readonly entries: readonly ExtUiEntry[];
  readonly pinned: readonly string[];
  readonly titles: ReadonlyMap<string, string>;
  readonly locale: string;
}): readonly AdditionGroup[] {
  const groups: AdditionGroup[] = [];
  for (const place of PLACES) {
    const rows =
      place === "tab"
        ? tabRowsOf(input.pinned, input.titles)
        : rowsOfPlace(place, input.entries, input.titles, input.locale);
    if (rows.length > 0) groups.push({ place, rows });
  }
  return groups;
}
