// P-13 확장 층 표: 선 격자 LineGrid(_shell/line-grid, 옛 언어 이식; 행 = 확장, 층이 바뀌는 경계에 표식).
// 상태 점은 사용자가 행동해야 할 때만(실패 있음 warning, 자동 꺼짐 danger). 켜짐·꺼짐은 글자만(LineGridDot에 success 점이 없다, 디자인 언어 §3).
// 층은 사람 말(T.layer*)로, id·버전 mono는 두지 않는다. 읽는 중은 같은 칸의 Skeleton이라 자리가 튀지 않는다.
// compact 폭은 신뢰 수준 열을 뺀다. 이름 열만 늘어나고 칸 글자는 한 줄 말줄임(N-49).
import { Skeleton, Switch, Tooltip } from "@caustic/react";
import type { ReactNode } from "react";
import {
  extName,
  L2,
  LineGrid,
  T,
  type Extension,
  type Layer,
  type LineGridCellData,
  type LineGridColumn,
  type LineGridDot,
  type LineGridRow,
  type Layout,
} from "../../_shell";
import { statusOf, trustLabel } from "../../_wb-c/ext-table";

export const layerName: Record<Layer, string> = {
  L0: T.layerL0,
  L1: T.layerL1,
  L2: T.layerL2,
  L3: T.layerL3,
  plugin: T.plugin,
  X: T.layerX,
};

/** 표의 층 순서: 위가 사용자에게 가까운 층. 같은 층끼리 붙어야 경계 표식이 한 번씩만 나온다. */
const LAYER_ORDER: readonly Layer[] = ["L3", "L2", "plugin", "L1", "L0", "X"];

function columns(compact: boolean): LineGridColumn[] {
  return [
    { id: "layer", label: T.layer, width: compact ? "7.5rem" : "9rem" },
    ...(compact ? [] : [{ id: "trust", label: T.trust, width: "9rem" }]),
    { id: "state", label: L2("상태", "Status"), width: compact ? "9rem" : "11rem" },
    { id: "on", label: <span className="sr-only">{L2("켜짐", "On")}</span>, width: "5.25rem" },
  ];
}

/** 왼쪽 위 칸 제목. caustic corner는 footnote라 옆 머리 칸(title-3)과 맞춘다. */
const HeadText = ({ children }: { children: ReactNode }) => (
  <span className="text-title-3 text-text-primary">{children}</span>
);

const SKELETON_W = [62, 48, 70, 54, 40];

function OnSwitch({ e }: { e: Extension }) {
  const name = extName(e.name);
  const on = e.status === "enabled";
  // LineGrid가 칸의 Enter·Space를 가져가므로 스위치의 키는 위로 올리지 않는다.
  return e.exempt === true ? (
    <Tooltip
      content={L2("기본 동작이라 끌 수 없어요", "Core behavior: can't be turned off")}
      side="left"
    >
      <span
        tabIndex={0}
        aria-label={`${name}, ${on ? L2("켜짐", "on") : L2("꺼짐", "off")}, ${L2("바꿀 수 없음", "locked")}`}
        className="inline-flex rounded-full outline-none focus-visible:focus-ring"
      >
        <Switch size="sm" checked={on} disabled aria-hidden tabIndex={-1} />
      </span>
    </Tooltip>
  ) : (
    <span className="inline-flex" onKeyDown={(k) => k.stopPropagation()}>
      <Switch
        size="sm"
        checked={on}
        aria-label={`${name} ${on ? L2("끄기", "turn off") : L2("켜기", "turn on")}`}
      />
    </span>
  );
}

function dataCell(e: Extension, col: string): LineGridCellData | null {
  switch (col) {
    case "layer":
      return { items: [{ id: "v", label: layerName[e.layer], muted: true }] };
    case "trust":
      return { items: [{ id: "v", label: trustLabel(e), muted: true }] };
    case "state": {
      const st = statusOf(e);
      const dot: LineGridDot | undefined =
        st.tone === "warning" || st.tone === "danger" ? st.tone : undefined;
      return {
        items: [{ id: "v", label: st.text, muted: true, ...(dot !== undefined ? { dot } : {}) }],
      };
    }
    case "on":
      return { items: [{ id: "v", label: <OnSwitch e={e} /> }] };
    default:
      return null;
  }
}

export function ExtList({
  rows,
  layout,
  loading = false,
}: {
  rows: Extension[];
  layout: Layout;
  loading?: boolean;
}) {
  const cols = columns(layout === "compact");
  if (loading)
    return (
      <LineGrid
        label={T.extension}
        corner={<HeadText>{L2("이름", "Name")}</HeadText>}
        aria-busy
        columns={cols}
        rowHeadWidth="minmax(0, 1fr)"
        rows={SKELETON_W.map((w): LineGridRow => ({
          id: `sk-${w}`,
          label: <Skeleton className="h-4" style={{ width: `${w * 2.5}px` }} />,
        }))}
        cell={(_r, c) => ({
          items: [
            {
              id: "v",
              label:
                c === "on" ? (
                  <Skeleton className="h-4 w-7 rounded-full" />
                ) : (
                  <Skeleton className="h-4 w-16" />
                ),
            },
          ],
        })}
      />
    );
  const sorted = LAYER_ORDER.flatMap((l) => rows.filter((e) => e.layer === l));
  return (
    <LineGrid
      label={T.extension}
      corner={<HeadText>{L2("이름", "Name")}</HeadText>}
      columns={cols}
      rowHeadWidth="minmax(0, 1fr)"
      rows={sorted.map((e): LineGridRow => ({
        id: e.name,
        label: extName(e.name),
        group: e.layer,
      }))}
      cell={(r, c) => {
        const e = sorted.find((x) => x.name === r);
        return e === undefined ? null : dataCell(e, c);
      }}
    />
  );
}
