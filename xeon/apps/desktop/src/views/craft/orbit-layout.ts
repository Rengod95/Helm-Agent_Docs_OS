// 지도(Orbit)의 세계 좌표 배치. 같은 스냅샷이면 언제나 같은 값을 준다(화면 크기와 무관).
// 층마다 고리 하나에 점을 각도로 고르게 놓는다. 그룹 구성원은 순서에서 붙어 있어 같은 고리 위에서 이웃이 된다.
// 고리 위쪽(0도 근처)은 층 이름표가 앉으므로 빈 틈으로 둔다. 목업의 ANGLE 표는 고정 데이터용이라 쓰지 않는다.
import {
  CENTER,
  type CanvasPlugin,
  type CanvasSnapshot,
  type LayerKey,
} from "@fresnel/client/workbench/canvas";

/** 가장 바깥 호의 반지름(세계 좌표). 모델의 OUTER와 같아야 한다(모델은 내보내지 않아 되풀이한다; 맞춤 시험이 확인한다) */
export const ORBIT_OUTER = 460;
/** 층 고리의 반지름 비율(ORBIT_OUTER 기준). 바깥 고리는 호 안쪽에 머문다 */
const RING_FRAC: Readonly<Record<LayerKey, number>> = { L1: 0.28, L2: 0.5, L3: 0.71, plugin: 0.89 };
/** 고리 순서: 안쪽부터 */
export const RING_ORDER: readonly LayerKey[] = ["L1", "L2", "L3", "plugin"];
/** 맨 위(0도) 양쪽의 빈 틈(도). 층 이름표가 점에 가리지 않게 한다 */
export const GAP_DEG = 24;
/** 그룹 호가 구성원 끝 각도보다 넓게 도는 여유(도) */
const ARC_PAD_DEG = 4;
/** 호가 겹치면 한 겹 위로 올리는 간격(세계 좌표) */
export const ARC_LANE_GAP = 12;
/** 호가 올라갈 수 있는 가장 바깥 반지름(세계 좌표). 1000 칸 안에 든다 */
const ARC_RADIUS_MAX = 490;
/** 같은 고리에서 이웃한 두 점의 최소 현(세계 좌표). 점 지름 28px과 틈이 들어가는 크기로 77개 확장에서 시험한다 */
export const MIN_CHORD = 44;

export interface OrbitDot {
  readonly id: string;
  readonly ring: LayerKey;
  /** 위(0도)에서 시계 방향 각도 */
  readonly angle: number;
  readonly x: number;
  readonly y: number;
}

export interface OrbitArc {
  readonly groupId: string;
  /** 시작·끝 각도(도). from < to, 0~360 안 */
  readonly from: number;
  readonly to: number;
  readonly radius: number;
}

export interface OrbitLayout {
  readonly dots: readonly OrbitDot[];
  readonly arcs: readonly OrbitArc[];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** 중심에서 반지름 r, 위에서 시계 방향 각도 deg인 세계 좌표 */
export function pointAt(radius: number, deg: number): { readonly x: number; readonly y: number } {
  return {
    x: CENTER + radius * Math.sin(rad(deg)),
    y: CENTER - radius * Math.cos(rad(deg)),
  };
}

/** 고리의 반지름(세계 좌표) */
export function ringRadius(ring: LayerKey): number {
  return RING_FRAC[ring] * ORBIT_OUTER;
}

/** 고리 안의 j번째 점(0부터)의 각도. 한 개면 아래(180도), 여럿이면 빈 틈 사이에 고르게 편다 */
export function angleAt(j: number, count: number): number {
  if (count <= 1) return 180;
  return GAP_DEG + (j * (360 - 2 * GAP_DEG)) / (count - 1);
}

/**
 * 점을 놓을 순서. 스냅샷 순서를 따르되 그룹 구성원은 그룹의 첫 구성원이 있는 자리에 모아 붙인다.
 * 그룹 목록에 없는 id는 무시하고, 같은 id가 두 번 나오면 처음 것만 쓴다.
 */
export function placementOrder(snapshot: CanvasSnapshot): CanvasPlugin[] {
  const byId = new Map<string, CanvasPlugin>();
  for (const p of snapshot.plugins) if (!byId.has(p.id)) byId.set(p.id, p);

  const groupOf = new Map<string, string>();
  const membersOf = new Map<string, readonly string[]>();
  for (const g of snapshot.groups) {
    const present = g.members.filter((id) => byId.has(id) && !groupOf.has(id));
    for (const id of present) groupOf.set(id, g.id);
    membersOf.set(g.id, present);
  }

  const placed = new Set<string>();
  const out: CanvasPlugin[] = [];
  for (const p of byId.values()) {
    if (placed.has(p.id)) continue;
    const gid = groupOf.get(p.id);
    const block = gid === undefined ? [p.id] : (membersOf.get(gid) ?? [p.id]);
    for (const id of block) {
      if (placed.has(id)) continue;
      const q = byId.get(id);
      if (q === undefined) continue;
      placed.add(id);
      out.push(q);
    }
  }
  return out;
}

/**
 * 호를 겹치지 않게 겹(lane)에 나눈다. 앞선 호와 겹치면 한 겹 위로 올린다.
 * 입력 순서대로 겹을 정하므로 같은 입력이면 같은 답이다.
 */
function laneArcs(
  spans: readonly { readonly groupId: string; readonly from: number; readonly to: number }[],
): OrbitArc[] {
  const sorted = spans.toSorted((a, b) => a.from - b.from || (a.groupId < b.groupId ? -1 : 1));
  const laneEnd: number[] = [];
  const lane = new Map<string, number>();
  for (const s of sorted) {
    let at = laneEnd.findIndex((end) => end <= s.from);
    if (at < 0) {
      at = laneEnd.length;
      laneEnd.push(s.to);
    } else {
      laneEnd[at] = s.to;
    }
    lane.set(s.groupId, at);
  }
  return spans.map((s) => {
    const k = lane.get(s.groupId) ?? 0;
    return {
      groupId: s.groupId,
      from: s.from,
      to: s.to,
      radius: Math.min(ORBIT_OUTER + k * ARC_LANE_GAP, ARC_RADIUS_MAX),
    };
  });
}

/** 스냅샷의 지도 배치. 점은 고리마다 고르게, 호는 그룹마다 한 개(겹치면 겹을 올린다) */
export function layoutOrbit(snapshot: CanvasSnapshot): OrbitLayout {
  const order = placementOrder(snapshot);
  const dots: OrbitDot[] = [];
  const angleOf = new Map<string, number>();
  for (const ring of RING_ORDER) {
    const list = order.filter((p) => p.layer === ring);
    const r = ringRadius(ring);
    list.forEach((p, j) => {
      const angle = angleAt(j, list.length);
      const at = pointAt(r, angle);
      angleOf.set(p.id, angle);
      dots.push({ id: p.id, ring, angle, x: at.x, y: at.y });
    });
  }

  const spans: { groupId: string; from: number; to: number }[] = [];
  for (const g of snapshot.groups) {
    const angles = g.members
      .map((id) => angleOf.get(id))
      .filter((a): a is number => a !== undefined);
    if (angles.length === 0) continue;
    spans.push({
      groupId: g.id,
      from: Math.max(0, Math.min(...angles) - ARC_PAD_DEG),
      to: Math.min(360, Math.max(...angles) + ARC_PAD_DEG),
    });
  }
  return { dots, arcs: laneArcs(spans) };
}
