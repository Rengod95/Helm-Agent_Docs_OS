// 선택과 켜짐 스위치. 상태는 값으로 주고받고 입력을 고치지 않는다.
// 스위치는 그룹마다 하나다(결정 15-1): 그룹 구성원 하나를 끄면 그룹 전체가 함께 바뀐다.
import type { CanvasPlugin, CanvasSnapshot, Sel } from "./types.ts";

export interface SelState {
  readonly sel: Sel;
  /** 선택 패널이 열렸나. 층 선택은 링에서 따로 연다 */
  readonly panel: boolean;
}

export function selectPlugin(id: string, open = true): SelState {
  return { sel: { k: "plugin", id }, panel: open };
}

export function selectGroup(id: string, open = true): SelState {
  return { sel: { k: "group", id }, panel: open };
}

/** 처음 상태: 에이전트를 고르고 패널은 닫는다 */
export function clearSel(): SelState {
  return { sel: { k: "agent" }, panel: false };
}

/** 켜짐: 스위치가 켜져 있고 연속 실패로 자동 꺼지지 않았다 */
export function isOn(p: CanvasPlugin): boolean {
  return p.on && p.health?.autoOff !== true;
}

/**
 * 플러그인 하나의 스위치가 바꾸는 대상. 그룹에 속하면 그룹 구성원 전부, 아니면 자기 하나다.
 * 그룹 id를 주면 구성원 전부다. 플러그인 id가 먼저 이긴다(그룹 루트와 id가 같을 때).
 */
export function toggleTargets(snapshot: CanvasSnapshot, id: string): string[] {
  const plugin = snapshot.plugins.find((p) => p.id === id);
  if (plugin === undefined) {
    const asGroup = snapshot.groups.find((g) => g.id === id);
    return asGroup === undefined ? [] : [...asGroup.members];
  }
  const gid = plugin.group;
  const owner = gid === undefined ? undefined : snapshot.groups.find((g) => g.id === gid);
  return owner === undefined ? [id] : [...owner.members];
}

/** 켜기·끄기 한 번. 자동 꺼짐이었던 것을 다시 켜면 실패 기록을 통째로 지운다 */
function switched(p: CanvasPlugin, on: boolean): CanvasPlugin {
  if (on && p.health?.autoOff === true) {
    const { health: _cleared, ...rest } = p;
    return { ...rest, on };
  }
  return { ...p, on };
}

/** toggleTargets가 고른 플러그인들을 on으로 바꾼 새 스냅샷. 입력은 그대로다 */
export function applyToggle(snapshot: CanvasSnapshot, id: string, on: boolean): CanvasSnapshot {
  const targets = new Set(toggleTargets(snapshot, id));
  return {
    ...snapshot,
    plugins: snapshot.plugins.map((p) => (targets.has(p.id) ? switched(p, on) : p)),
  };
}
