// 플러그인 내부 판의 기하(순수). 같은 궤도 문법을 한 단계 안에서 다시 쓴다:
//  - Drive: 가운데가 그 플러그인의 자기 루프(단계가 정거장)이고, 그 안에 작은 코어 고리가 있다(단계마다 코어 루프를 돌린다).
//  - 그 밖: 가운데가 작은 코어 고리이고, 플러그인이 붙는 지점 하나가 밝다. 내용(지침·스킬·도구·핸들러)은 그 지점 쪽 호에 놓인다.
// 설정과 권한은 성질이라 선으로 잇지 않고 오른쪽 열에 둔다.
import { POINT_ANGLE, STATION_ANGLE, polar, type Pt } from "./layout.ts";
import { slotOf, type Part, type PluginDef, type Slot, type Stage } from "./model.ts";

export const PART_SIZE: Pt = { x: 176, y: 56 };
export const MINI_RING = 118;
export const OWN_RING = 168;
export const OWN_CORE = 62;

export interface PlacedPart {
  readonly key: string;
  readonly part: Part;
  readonly c: Pt;
  /** 잇는 선의 끝(없으면 선 없음) */
  readonly to?: Pt;
}

export interface PlacedStage {
  readonly key: string;
  readonly stage: Stage;
  readonly deg: number;
  /** 고리 위 정거장 */
  readonly bead: Pt;
  /** 이름표 카드 중심(고리 바깥) */
  readonly c: Pt;
}

export interface InsideBoard {
  readonly mode: "drive" | "attach";
  /** attach: 작은 코어 고리 위에서 밝힐 자리 */
  readonly slot: Slot;
  readonly anchor: Pt;
  readonly parts: readonly PlacedPart[];
  readonly stages: readonly PlacedStage[];
  /** Drive: 나가는 핸드오프의 고리 위 출발점과 대상 자리 */
  readonly exits: readonly { readonly to: string; readonly from: Pt; readonly c: Pt }[];
  readonly bounds: { readonly min: Pt; readonly max: Pt };
}

const PROPERTY = new Set(["setting", "permission"]);

function slotDeg(slot: Slot): number {
  if (slot === "inside") return STATION_ANGLE.context;
  if (slot === "socket") return STATION_ANGLE.tools;
  if (slot === "drive") return 180;
  return POINT_ANGLE[slot];
}

/** 각도 θ 둘레의 호에 n개를 고르게(타일 높이만큼 띄워) */
function arcAround(n: number, deg: number, r: number): readonly Pt[] {
  const step = ((PART_SIZE.y + 14) / r) * (180 / Math.PI);
  return Array.from({ length: n }, (_, i) => polar(r, deg + (i - (n - 1) / 2) * step));
}

/** 내부 Drive 판의 들어오는 자리(첫 메시지·받는 핸드오프)의 각도 */
export const ENTRY_DEG = -128;

function column(n: number, x: number): readonly Pt[] {
  const step = PART_SIZE.y + 14;
  return Array.from({ length: n }, (_, i) => ({ x, y: (i - (n - 1) / 2) * step }));
}

function keyOf(p: Part, i: number): string {
  return `${p.kind}:${p.key ?? p.raw ?? ""}:${String(i)}`;
}

export function insideLayout(def: PluginDef): InsideBoard {
  const content = def.parts.filter((p) => !PROPERTY.has(p.kind));
  const props = def.parts.filter((p) => PROPERTY.has(p.kind));

  if (def.kind === "drive") {
    const stages = def.stages ?? [];
    const step = 360 / Math.max(1, stages.length);
    const placedStages = stages.map((stage, i) => {
      const deg = -90 + i * step;
      return {
        key: stage.key,
        stage,
        deg,
        bead: polar(OWN_RING, deg),
        c: polar(OWN_RING + 92, deg),
      };
    });
    // 오른쪽 열: 위는 내용(고리 오른쪽 위에 닿는다), 한 칸 띄우고 아래는 성질
    const colX = OWN_RING + 300;
    const rowStep = PART_SIZE.y + 14;
    const total =
      content.length * rowStep +
      (props.length > 0 && content.length > 0 ? 24 : 0) +
      props.length * rowStep -
      14;
    const top = -20 - total / 2 + PART_SIZE.y / 2;
    const parts: PlacedPart[] = [];
    content.forEach((part, i) => {
      parts.push({
        key: keyOf(part, i),
        part,
        c: { x: colX, y: top + i * rowStep },
        to: polar(OWN_RING, -44 + i * 13),
      });
    });
    const propTop = top + content.length * rowStep + (content.length > 0 ? 24 : 0);
    props.forEach((part, i) => {
      parts.push({
        key: keyOf(part, i + content.length),
        part,
        c: { x: colX, y: propTop + i * rowStep },
      });
    });
    const lastDeg = -90 + (stages.length - 1) * step + step / 2;
    const exits = (def.handoff ?? []).map((to, i) => ({
      to,
      from: polar(OWN_RING, lastDeg),
      c: polar(OWN_RING + 200 + i * 40, lastDeg - 18 + i * 24),
    }));
    return {
      mode: "drive",
      slot: "drive",
      anchor: { x: 0, y: 0 },
      parts,
      stages: placedStages,
      exits,
      bounds: boundsOf(parts, placedStages, exits, OWN_RING),
    };
  }

  const slot = slotOf(def);
  const deg = slotDeg(slot);
  const anchor = polar(MINI_RING, deg);
  const toolAnchor = polar(MINI_RING, STATION_ANGLE.tools);
  const parts: PlacedPart[] = arcAround(content.length, deg, MINI_RING + 230)
    .map((c, i) => {
      const part = content[i];
      if (part === undefined) return null;
      // Inject가 함께 넣는 도구는 도구 실행 정거장에 닿는다
      const to = part.kind === "tool" && def.kind === "inject" ? toolAnchor : anchor;
      return { key: keyOf(part, i), part, c, to };
    })
    .filter((p) => p !== null);
  // 성질 열은 내용 호의 반대편에 둔다
  const side = Math.cos((deg * Math.PI) / 180) <= 0 ? 1 : -1;
  column(props.length, side * (MINI_RING + 300)).forEach((c, i) => {
    const part = props[i];
    if (part !== undefined) parts.push({ key: keyOf(part, i + content.length), part, c });
  });
  return {
    mode: "attach",
    slot,
    anchor,
    parts,
    stages: [],
    exits: [],
    bounds: boundsOf(parts, [], [], MINI_RING),
  };
}

function boundsOf(
  parts: readonly PlacedPart[],
  stages: readonly PlacedStage[],
  exits: readonly { readonly c: Pt }[],
  ring: number,
): { min: Pt; max: Pt } {
  let min = { x: -ring - 60, y: -ring - 60 };
  let max = { x: ring + 60, y: ring + 60 };
  const grow = (c: Pt, hx: number, hy: number): void => {
    min = { x: Math.min(min.x, c.x - hx), y: Math.min(min.y, c.y - hy) };
    max = { x: Math.max(max.x, c.x + hx), y: Math.max(max.y, c.y + hy) };
  };
  for (const p of parts) grow(p.c, PART_SIZE.x / 2, PART_SIZE.y / 2);
  for (const s of stages) grow(s.c, 70, 30);
  for (const e of exits) grow(e.c, 60, 60);
  return { min, max };
}
