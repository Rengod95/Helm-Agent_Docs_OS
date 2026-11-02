// 층 × 단계 표: 행 = 층, 열 = 턴 흐름 단계, 칸 = 그 층에서 그 단계에 훅을 건 플러그인 이름.
// 공용 _shell/line-grid LineGrid를 그대로 쓴다. 칸 안은 이름 글자만, 손볼 것(자동 꺼짐·실패)만 6px 점, 빈 칸은 빗금.
// 숫자(훅 수·지연)·색칠은 쓰지 않는다. 층·단계 이름을 누르면 행·열을 고르고(onSelectRow·onSelectColumn),
// 칸 안 플러그인 이름을 누르면 그 플러그인으로 관계 포커스를 건다(onItemSelect). 열이 일곱이라 compact 밀도.
import { LineGrid, type LineGridDot, type LineGridItem } from "../../_shell";
import { T } from "../../_shell/terms";
import {
  HOOKS,
  PRESET_DIFF,
  STAGES,
  THREAD_ON,
  layerName,
  pluginById,
  relationsOf,
  stageOf,
  viewOf,
  type LayerId,
  type Plugin,
  type StageId,
} from "../data";
import { useMock } from "../store";

/** 표에 두는 층. F(계약)는 플러그인이 없어 행이 없다. X는 따로 묶음(경계에 "+"). */
export const TABLE_LAYERS: readonly LayerId[] = ["L3", "L2", "L1", "L0", "X"];

/** 층 이름 칸 폭. 표 아래 구역도 이 폭에 맞춰 첫 칸의 글자와 줄을 맞춘다. */
export const ROW_HEAD = "9rem";

/** 손봐야 하는 상태만 점. 정상·꺼짐은 점 없음. */
function dotOf(p: Plugin): LineGridDot | undefined {
  if (p.health === "auto_off") return "danger";
  if (p.health === "failing") return "warning";
  return undefined;
}

/** 보기 기준에 따라 칸에 나올 플러그인. 대화면 그 대화에서 켜진 것만, 미리보기면 적용한 뒤 모습. */
export function useCellPlugins() {
  const m = useMock();
  const v = viewOf(m.view);
  const inThread = v.kind === "thread" || v.kind === "trial";
  return (row: LayerId, col: StageId) => {
    const ids = [
      ...new Set(
        HOOKS.filter((h) => stageOf(h.point) === col && pluginById(h.plugin).layer === row).map(
          (h) => h.plugin,
        ),
      ),
    ];
    return ids
      .map((id) => {
        const d = m.preview === null ? undefined : PRESET_DIFF[id];
        const on = THREAD_ON.has(id);
        return { p: pluginById(id), mark: d?.mark, shown: !inThread || on || d?.mark === "add" };
      })
      .filter((x) => x.shown);
  };
}

export function LayerTable() {
  const m = useMock();
  const cellPlugins = useCellPlugins();
  const related =
    m.focus === null ? null : new Set([m.focus, ...relationsOf(m.focus).map((r) => r.target)]);
  const pick = m.pick;
  return (
    <LineGrid
      label={`${T.layer}과 ${T.step}`}
      density="compact"
      style={{ minWidth: "880px" }}
      rowHeadWidth={ROW_HEAD}
      columns={STAGES.map((s) => ({ id: s.id, label: s.label }))}
      rows={TABLE_LAYERS.map((l) => ({
        id: l,
        group: l === "X" ? "x" : "layers",
        label: layerName(l),
      }))}
      cell={(r, c) => {
        const row = TABLE_LAYERS.find((l) => l === r);
        const col = STAGES.find((s) => s.id === c);
        if (row === undefined || col === undefined) return null;
        const items: LineGridItem[] = cellPlugins(row, col.id).map(({ p, mark }) => {
          const dot = mark === "add" ? "neutral" : dotOf(p);
          return {
            id: p.id,
            label: p.name,
            ...(mark === "remove" ? { struck: true } : {}),
            ...(dot === undefined ? {} : { dot }),
          };
        });
        return { items };
      }}
      selected={pick}
      focus={related === null ? undefined : (_r, _c, id) => related.has(id)}
      onSelect={(r, c) => {
        const row = TABLE_LAYERS.find((l) => l === r);
        const col = STAGES.find((s) => s.id === c);
        if (row !== undefined && col !== undefined) m.set({ pick: { row, col: col.id } });
      }}
      onSelectRow={(r) => {
        const row = TABLE_LAYERS.find((l) => l === r);
        if (row !== undefined) m.set({ pick: { row }, focus: null });
      }}
      onSelectColumn={(c) => {
        const col = STAGES.find((s) => s.id === c);
        if (col !== undefined) m.set({ pick: { col: col.id }, focus: null });
      }}
      onItemSelect={(_r, _c, id) => m.set({ focus: id, pick: {} })}
    />
  );
}
