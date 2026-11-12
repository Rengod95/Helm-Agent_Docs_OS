// 머리 줄 플레이그라운드 탭의 모델(L4.desktop-ux DP-90 [결정: 2026-11-11 사용자]). 순수 함수이고 그리지 않는다.
// 화면(page, Helm이 아닌 panel)을 가진 플러그인은 처음 보일 때 자동으로 끝에 고정된다. 사용자가 뗀 플러그인은 `seen`에 남아
// 다시 자동 고정하지 않는다. 지워진 플러그인은 탭에서 빠지지만 `seen`과 `pinned`에서는 지우지 않는다(다시 설치하면 자리가 남는다).
// 저장은 로컬 설정 `l4.desktop.window.playgroundTabs`(`commands.playgroundTabs`)다.

export interface PlaygroundTabsPrefs {
  /** 고정된 플러그인 이름, 탭 순서 */
  readonly pinned: readonly string[];
  /** 자동 고정을 한 번 거친 이름 */
  readonly seen: readonly string[];
}

export const EMPTY_TAB_PREFS: PlaygroundTabsPrefs = { pinned: [], seen: [] };

/** 저장 목록 상한(로컬 설정 스키마와 같다). 넘으면 오래된 것부터 버린다 */
const LIST_MAX = 256;

const capped = (list: readonly string[]): readonly string[] =>
  list.length > LIST_MAX ? list.slice(list.length - LIST_MAX) : list;

/**
 * 지금 화면을 가진 플러그인(`tabbable`, 보일 순서)을 받아 처음 보는 것을 끝에 고정한다. 바뀐 것이 없으면 받은 값을 그대로 돌려준다
 * (저장을 건너뛰는 데 쓴다)
 */
export function withAutoPinned(
  prefs: PlaygroundTabsPrefs,
  tabbable: readonly string[],
): PlaygroundTabsPrefs {
  const seen = new Set(prefs.seen);
  const fresh = tabbable.filter((name) => !seen.has(name));
  if (fresh.length === 0) return prefs;
  return {
    pinned: capped([...prefs.pinned, ...fresh.filter((name) => !prefs.pinned.includes(name))]),
    seen: capped([...prefs.seen, ...fresh]),
  };
}

/** 머리 줄에 보일 탭: 고정 순서 가운데 지금 화면을 가진 플러그인만 */
export function pinnedTabsOf(
  prefs: PlaygroundTabsPrefs,
  tabbable: readonly string[],
): readonly string[] {
  const present = new Set(tabbable);
  return prefs.pinned.filter((name) => present.has(name));
}

export function isPinned(prefs: PlaygroundTabsPrefs, name: string): boolean {
  return prefs.pinned.includes(name);
}

export function withPinned(
  prefs: PlaygroundTabsPrefs,
  name: string,
  pinned: boolean,
): PlaygroundTabsPrefs {
  const seen = prefs.seen.includes(name) ? prefs.seen : capped([...prefs.seen, name]);
  if (pinned) {
    return prefs.pinned.includes(name)
      ? { pinned: prefs.pinned, seen }
      : { pinned: capped([...prefs.pinned, name]), seen };
  }
  return { pinned: prefs.pinned.filter((item) => item !== name), seen };
}

/**
 * 탭 하나를 보이는 탭 사이에서 `delta`칸(-1 왼쪽, +1 오른쪽) 옮긴다. 보이지 않는 고정(지워진 플러그인)은 제자리에 둔다.
 * 끝에서는 움직이지 않는다
 */
export function withMoved(
  prefs: PlaygroundTabsPrefs,
  tabbable: readonly string[],
  name: string,
  delta: -1 | 1,
): PlaygroundTabsPrefs {
  const shown = pinnedTabsOf(prefs, tabbable);
  const from = shown.indexOf(name);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= shown.length) return prefs;
  // 왼쪽은 옆 탭 앞에, 오른쪽은 옆 탭 다음 탭 앞에(없으면 맨 끝) 놓는다
  const before = delta < 0 ? shown[to] : shown[to + 1];
  return withDropped(prefs, tabbable, name, before ?? null);
}

/**
 * 끌어 놓기: `name`을 보이는 탭 `before` 앞에 놓는다(`null`이면 맨 끝). 제자리면 받은 값을 그대로 돌려준다
 */
export function withDropped(
  prefs: PlaygroundTabsPrefs,
  tabbable: readonly string[],
  name: string,
  before: string | null,
): PlaygroundTabsPrefs {
  if (!prefs.pinned.includes(name) || name === before) return prefs;
  const shown = pinnedTabsOf(prefs, tabbable);
  const rest = shown.filter((item) => item !== name);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at < 0) return prefs;
  const order = [...rest.slice(0, at), name, ...rest.slice(at)];
  if (order.every((item, index) => shown[index] === item)) return prefs;
  // 보이지 않는 고정은 그 앞에 있던 보이는 탭과의 상대 자리를 잃지 않게 끝에 그대로 붙인다
  const hidden = prefs.pinned.filter((item) => !shown.includes(item));
  return { pinned: [...order, ...hidden], seen: prefs.seen };
}

/** 탭 줄 배치. `label`은 아이콘과 이름, `icon`은 아이콘만. `visible`개 뒤는 "더 보기" 메뉴로 접는다 */
export interface TabStripLayout {
  readonly mode: "label" | "icon";
  readonly visible: number;
}

/** 이름 탭 하나의 최대 폭(px, 이름 128 + 아이콘·여백) */
export const LABEL_TAB_MAX = 160;
/** 아이콘 탭 하나의 폭(28 + 사이 2, px) */
export const ICON_TAB = 30;
/** "더 보기" 단추 자리(px) */
const MORE_BUTTON = 48;

/**
 * 쓸 수 있는 폭(`avail`, px)에 탭 `count`개를 놓는 방법. 이름 탭이 다 들어가면 이름, 아니면 아이콘, 그래도 넘치면 들어가는 만큼과
 * "더 보기"다. `compact`(좁은 창)는 늘 아이콘이다. 폭이 하나도 안 되면 0개와 "더 보기"다
 */
export function tabStripLayoutOf(count: number, avail: number, compact: boolean): TabStripLayout {
  if (count <= 0) return { mode: "icon", visible: 0 };
  if (!compact && count * LABEL_TAB_MAX <= avail) return { mode: "label", visible: count };
  if (count * ICON_TAB <= avail) return { mode: "icon", visible: count };
  const fit = Math.floor(Math.max(0, avail - MORE_BUTTON) / ICON_TAB);
  return { mode: "icon", visible: Math.min(count, fit) };
}

/** 열어 둔(상태를 지키는) 탭 수의 상한. 넘으면 가장 오래 안 본 것부터 내린다 */
export const KEPT_TABS_MAX = 8;

/** 최근에 본 순서 목록에 `key`를 맨 앞으로 올리고 상한을 넘는 끝을 자른다 */
export function touchedOf(order: readonly string[], key: string): readonly string[] {
  const next = [key, ...order.filter((item) => item !== key)];
  return next.length > KEPT_TABS_MAX ? next.slice(0, KEPT_TABS_MAX) : next;
}
