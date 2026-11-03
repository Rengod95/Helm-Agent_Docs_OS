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
