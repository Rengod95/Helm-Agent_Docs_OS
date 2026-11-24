import { activeLocale } from "@fresnel/client/i18n";
import { extMessageOf } from "@fresnel/client/views/native";
import type { ExtUiEntry } from "@fresnel/contracts/wire";

// 좁은 옆 패널(플러그인 앱과 알림, Helm 패널)의 화면 탭 줄 계산(AGE-73 railFix).
// 탭 줄은 남는 폭을 다 쓰고, 다 들지 않으면 앞에서부터 드는 만큼만 보이고 나머지는 "다른 화면" 메뉴로 접는다.
// 지금 고른 화면은 늘 보이는 탭에 든다(넘치는 자리였으면 마지막 보이는 탭과 바꾼다).

/** 화면 이름: 화면 제목을 지금 로케일로 푼다 */
export function screenTitleOf(entry: ExtUiEntry): string {
  return extMessageOf(entry.messages, activeLocale(), entry.title);
}

/** 이름이 같은 화면이 둘 이상인 이름들. 그 화면들에는 어느 플러그인 것인지 플러그인 이름을 보조 글로 붙인다 */
export function duplicateTitlesOf(entries: readonly ExtUiEntry[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const entry of entries) {
    const title = screenTitleOf(entry);
    if (seen.has(title)) duplicated.add(title);
    seen.add(title);
  }
  return duplicated;
}

/** 탭 줄을 재는 값(모두 CSS px). `widths`는 탭마다 말줄임 없이 그린 폭(최대 폭으로 잘린 값)이다 */
export interface TabFit {
  readonly widths: readonly number[];
  /** 탭 줄이 쓸 수 있는 폭 */
  readonly available: number;
  /** 탭 사이 간격 */
  readonly gap: number;
  /** 넘칠 때 끝에 서는 "다른 화면" 단추 폭(앞 간격 포함) */
  readonly more: number;
  /** 지금 고른 탭의 차례. 없으면 -1 */
  readonly selected: number;
}

/**
 * 보이는 탭의 차례(오름차순). 모두 들면 전부다. 넘치면 "다른 화면" 단추 자리를 빼고 앞에서부터 드는 만큼이고, 적어도 하나다.
 * 고른 탭이 넘치는 쪽이면 마지막 보이는 탭 대신 넣는다(그래도 안 들면 고른 탭 하나만 둔다)
 */
export function visibleTabsOf(fit: TabFit): readonly number[] {
  const count = fit.widths.length;
  const all = fit.widths.map((_, index) => index);
  const total = (indexes: readonly number[]): number =>
    indexes.reduce((sum, index) => sum + (fit.widths[index] ?? 0), 0) +
    Math.max(0, indexes.length - 1) * fit.gap;
  if (count === 0 || total(all) <= fit.available) return all;
  const room = fit.available - fit.more;
  const shown: number[] = [];
  for (const index of all) {
    if (total([...shown, index]) > room) break;
    shown.push(index);
  }
  if (shown.length === 0) shown.push(0);
  if (fit.selected < 0 || fit.selected >= count || shown.includes(fit.selected)) return shown;
  const swapped = [...shown.slice(0, -1), fit.selected];
  return total(swapped) <= room || swapped.length === 1 ? swapped : [fit.selected];
}

/** 넘쳐서 "다른 화면" 메뉴에 들어갈 탭의 차례 */
export function hiddenTabsOf(count: number, visible: readonly number[]): readonly number[] {
  const shown = new Set(visible);
  return Array.from({ length: count }, (_, index) => index).filter((index) => !shown.has(index));
}
