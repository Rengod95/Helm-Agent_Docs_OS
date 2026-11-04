import { stripUnsafeText } from "@fresnel/client/views/app";
import type { Placement } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { appsAllowed } from "./policy-context.ts";

// 화면 항목을 여섯 배치 자리(page, panel, card, status, command, settings)로 묶는다. 순수 함수이고 그리지 않는다.
// 상태 `disabled`·`invalid` 항목도 목록에 남기고 상태를 그대로 둔다(호스트가 자리표시를 그린다).
// 앱 모드 항목인데 앱 정책이 막으면 `frame_blocked`로 표시한다. 호스트는 `entry.tree`가 있으면 그것을, 없으면 자리표시를 그린다.

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

/**
 * 항목을 배치별로 묶는다. 같은 배치 안은 확장 이름, 화면 id 순이다(`toSorted`는 안정 정렬이라 같은 쌍은 입력 순서를 지킨다).
 * `settings`는 `x.ui.apps`와 `x.ui.allowProjectApps` 값을 담은 객체다(`appsAllowed`가 읽는다)
 */
export function groupPlacements(
  entries: readonly ExtUiEntry[],
  settings: Readonly<Record<string, unknown>>,
): PlacementGroups {
  const placed: readonly PlacedEntry[] = entries
    .map((entry) => ({ entry, blocked: blockedOf(entry, settings) }))
    .toSorted(
      (left, right) =>
        compareText(left.entry.extension, right.entry.extension) ||
        compareText(left.entry.id, right.entry.id),
    );
  const at = (placement: Placement): readonly PlacedEntry[] =>
    placed.filter((item) => item.entry.placement === placement);
  return {
    page: at("page"),
    panel: at("panel"),
    card: at("card"),
    status: at("status"),
    command: at("command"),
    settings: at("settings"),
  };
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
 * 확장이 낸 글 하나의 표시 이름: `<확장> · <제목>`. 제목은 방향 제어 글자와 제어 문자를 뺀다. 제목이 비면 화면 id를 쓴다.
 * 확장 이름이 앞에 와서 셸의 행동 이름으로 읽히지 않는다(보고 2, 3)
 */
export function originTitleOf(entry: ExtUiEntry): string {
  const title = stripUnsafeText(entry.title, false).trim();
  return `${entry.extension} · ${title === "" ? entry.id : title}`;
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
