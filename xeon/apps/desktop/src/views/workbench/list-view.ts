// 플러그인 목록의 보기(표, 카드)와 표 정렬의 순수 모델(AGE-76 plugTab). 그리지 않는다. 표(`plugin-list.tsx`)와 카드(`plugin-cards.tsx`)가 쓴다.
// 정렬은 표 머리를 누를 때만 걸린다: 이름순(보이는 이름순)과 종류순(`KIND_ORDER`, 카드 없는 줄은 끝). 내림차순은 오름차순을 뒤집는다.
import type { ExtRowVM } from "@fresnel/client/workbench";
import { KIND_ORDER, type PluginKind } from "./plugin-kind.tsx";

const LIST_VIEWS = ["table", "cards"] as const;
export type ListView = (typeof LIST_VIEWS)[number];

/** 저장한 적이 없거나 값이 틀리면 표다 */
export const DEFAULT_LIST_VIEW: ListView = "table";

/** 고른 보기 값을 읽는다. 알 수 없는 값은 기본 보기다 */
export function listViewOf(value: string): ListView {
  return value === "cards" ? "cards" : DEFAULT_LIST_VIEW;
}

export type SortKey = "name" | "kind";
type SortDirection = "ascending" | "descending";

export interface TableSort {
  readonly key: SortKey;
  readonly direction: SortDirection;
}

/** 표가 준 열 키를 정렬 키로 읽는다. 정렬할 수 없는 열이면 null */
export function sortKeyOf(key: string): SortKey | null {
  return key === "name" || key === "kind" ? key : null;
}

const byShownName = (a: ExtRowVM, b: ExtRowVM): number =>
  (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name) || a.name.localeCompare(b.name);

/** 종류 순서 값. 카드 없는 줄(null)은 맨 뒤다 */
const kindRank = (kind: PluginKind | null): number =>
  kind === null ? KIND_ORDER.length : KIND_ORDER.indexOf(kind);

/** 묶음 안의 줄을 정렬한다. `sort`가 null이면 목록이 이미 정한 순서(보이는 이름순)를 그대로 쓴다 */
export function sortRows(
  rows: readonly ExtRowVM[],
  sort: TableSort | null,
  kindOf: (name: string) => PluginKind | null,
): readonly ExtRowVM[] {
  if (sort === null) return rows;
  const ascending =
    sort.key === "name"
      ? rows.toSorted(byShownName)
      : rows.toSorted(
          (a, b) => kindRank(kindOf(a.name)) - kindRank(kindOf(b.name)) || byShownName(a, b),
        );
  return sort.direction === "descending" ? ascending.toReversed() : ascending;
}
