// 자세히 보기의 대상과 옆 열 값(순수). 그룹이면 구성원 전부, 플러그인이면 자기 하나다.
// 켜기·끄기는 언제나 그룹 단위다(결정 15-1): 대상 id는 `toggleTargets`가 준다.
import {
  isOn,
  toggleTargets,
  type CanvasGroup,
  type CanvasPlugin,
  type CanvasSnapshot,
  type Origin,
} from "@fresnel/client/workbench/canvas";

export type DetailTarget =
  | { readonly k: "group"; readonly group: CanvasGroup; readonly members: readonly CanvasPlugin[] }
  | {
      readonly k: "plugin";
      readonly plugin: CanvasPlugin;
      /** 이 플러그인이 속한 그룹(없으면 undefined) */
      readonly group: CanvasGroup | undefined;
    };

function membersOf(snapshot: CanvasSnapshot, ids: readonly string[]): CanvasPlugin[] {
  return ids.flatMap((id) => {
    const p = snapshot.plugins.find((x) => x.id === id);
    return p === undefined ? [] : [p];
  });
}

/**
 * id가 그룹이면 그룹, 아니면 플러그인, 없으면 null. 그룹 id와 같은 루트 플러그인은 그룹이 이긴다
 * (플러그인만 따로 여는 길은 이 id 규칙으로는 없다).
 */
export function targetOf(snapshot: CanvasSnapshot, id: string | null): DetailTarget | null {
  if (id === null) return null;
  const group = snapshot.groups.find((g) => g.id === id);
  if (group !== undefined) {
    return { k: "group", group, members: membersOf(snapshot, group.members) };
  }
  const plugin = snapshot.plugins.find((p) => p.id === id);
  if (plugin === undefined) return null;
  const owner =
    plugin.group === undefined ? undefined : snapshot.groups.find((g) => g.id === plugin.group);
  return { k: "plugin", plugin, group: owner };
}

/** 대상의 구성원(플러그인이면 자기 하나) */
export function membersOfTarget(target: DetailTarget): readonly CanvasPlugin[] {
  return target.k === "group" ? target.members : [target.plugin];
}

/** 대상의 id(그룹이면 그룹 id) */
export function idOfTarget(target: DetailTarget): string {
  return target.k === "group" ? target.group.id : target.plugin.id;
}

/** 스위치 하나가 다루는 것: 대상 구성원 중 몇이 켜졌나 */
export interface SwitchModel {
  readonly targets: readonly string[];
  readonly total: number;
  readonly onCount: number;
  /** 연속 실패로 자동 꺼진 구성원이 있나 */
  readonly autoOff: boolean;
}

export function switchOf(snapshot: CanvasSnapshot, target: DetailTarget): SwitchModel {
  const targets = toggleTargets(snapshot, idOfTarget(target));
  const members = membersOf(snapshot, targets);
  return {
    targets,
    total: members.length,
    onCount: members.filter((p) => isOn(p)).length,
    autoOff: members.some((p) => p.health?.autoOff === true),
  };
}

/** 스위치가 가리키는 이름: 그룹에 속하면 그룹 이름(구성원 하나씩 끄는 길은 없다) */
export function switchNameOf(target: DetailTarget): string {
  if (target.k === "group") return target.group.name;
  return target.group === undefined ? target.plugin.name : target.group.name;
}

export function versionOf(target: DetailTarget): string | undefined {
  return target.k === "group" ? target.group.version : target.plugin.version;
}

export function originOf(target: DetailTarget): Origin {
  return target.k === "group" ? target.group.origin : target.plugin.origin;
}

/** 실패 한도(자동 꺼짐 기준). 실패 기록이 있는 구성원의 값이다. 기록이 없으면 엔진이 주지 않는다 */
export function failLimitOf(members: readonly CanvasPlugin[]): number | undefined {
  for (const p of members) {
    if (p.health !== undefined) return p.health.limit;
  }
  return undefined;
}

/**
 * 읽기 전용 코드 칸의 글. 매니페스트 원문은 wire에 없어서 스냅샷의 필드를 JSON으로 보인다.
 * [미결] 매니페스트 원문을 엔진이 주면 이 함수를 그 글로 바꾼다.
 */
export function codeOf(target: DetailTarget): string {
  if (target.k === "group") {
    const g = target.group;
    return JSON.stringify(
      {
        id: g.id,
        name: g.name,
        version: g.version,
        origin: g.origin,
        members: g.members,
        config: g.config,
      },
      null,
      2,
    );
  }
  const p = target.plugin;
  return JSON.stringify(
    {
      id: p.id,
      name: p.name,
      layer: p.layer,
      group: p.group,
      origin: p.origin,
      version: p.version,
      hooks: p.hooks,
      provides: p.provides,
      requires: p.requires,
      optional: p.optional,
      records: p.records,
      reads: p.reads,
      drives: p.drives,
      pieces: p.pieces,
    },
    null,
    2,
  );
}
