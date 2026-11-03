// 층 × 단계 표(디자인 언어 §7). wb-v3 표와 같은 데이터·같은 격자이고, 상태마다 칸 내용만 달라진다.
// 읽는 중: 머리는 그대로, 칸마다 글자 자리(빗금 없음: 아직 "해당 없음"인지 모른다). 안전 모드·빈: 실리지 않은 층은 빗금.
// 좁은 폭: 일곱 열이 들어가지 않아 행과 열을 바꾼다(행 = 단계, 열 = 층). 가로 스크롤 없이 턴 흐름 순서로 위에서 아래로 읽는다.
// 격자는 _shell의 선 격자 LineGrid(옛 언어 이식). 데이터는 wb-v3/data를 읽기만 한다.
import { Skeleton } from "@caustic/react";
import { LineGrid, T, type LineGridDot, type LineGridItem } from "../../_shell";
import {
  HOOKS,
  PLUGINS,
  STAGES,
  layerName,
  relationsOf,
  stageOf,
  type LayerId,
  type Plugin,
  type StageId,
} from "../../wb-v3/data";
import type { Look, Pick } from "../flow";

/** 표에 두는 층. F(계약)는 플러그인이 없어 행이 없다. X는 따로 묶음(경계 표식). (wb-v3 screens/layer-table과 같다.) */
export const TABLE_LAYERS: readonly LayerId[] = ["L3", "L2", "L1", "L0", "X"];

/** 층 이름 칸 폭(wb-v3와 같다). */
export const ROW_HEAD = "9rem";

/** 안전 모드에서 빠진 것을 한 줄로(결정 12). 문장은 조사만 josa로 맞춘다. */
export const SAFE_OFF = `${T.group}, 사용자·프로젝트 ${T.extension}, ${T.xHook}`;

/** wb-v3 HOOKS에는 내장 L0·L1·L2가 없다. 안전 모드에서 남는 표를 그리려면 있어야 해서 여기서 더한다. */
const BUILTIN_PLACES: readonly [string, StageId][] = [
  ["knowledge", "input"],
  ["web", "tool"],
  ["dialog", "tool"],
  ["work", "boundary"],
  ["web-exa", "tool"],
  ["loop", "thread"],
  ["loop", "boundary"],
  ["context", "input"],
  ["context", "request"],
  ["models", "request"],
  ["tools", "guard"],
  ["tools", "tool"],
  ["session", "thread"],
  ["session", "boundary"],
  ["agents", "lifecycle"],
  ["store", "thread"],
  ["secrets", "request"],
  ["sandbox", "guard"],
  ["exec", "tool"],
  ["process", "lifecycle"],
];

const PLACES: readonly [string, StageId][] = [
  ...BUILTIN_PLACES,
  ...HOOKS.map((h): [string, StageId] => [h.plugin, stageOf(h.point)]),
];

/** 안전 모드에서 남는 것: 내장 L0·L1·L2(결정 12). 빈 상태도 같은 모양이다(그룹을 켜지 않은 내장만의 설치). */
const onlyBuiltin = (p: Plugin) => p.origin === "builtin" && p.layer !== "L3" && p.layer !== "X";

const visible = (look: Look) => (p: Plugin) =>
  look === "safe-mode" || look === "empty" ? onlyBuiltin(p) : true;

export function pluginsAt(look: Look, row: LayerId, col: StageId): Plugin[] {
  const ids = new Set(PLACES.filter(([, s]) => s === col).map(([id]) => id));
  return PLUGINS.filter((p) => ids.has(p.id) && p.layer === row).filter(visible(look));
}

export const pluginsIn = (look: Look, row: LayerId): Plugin[] => {
  const ids = new Set(PLACES.map(([id]) => id));
  return PLUGINS.filter((p) => p.layer === row && ids.has(p.id)).filter(visible(look));
};

/** 안전 모드에서 빠진 것을 층별로. */
export const OUT_BY_LAYER: readonly { layer: LayerId; names: string[] }[] = TABLE_LAYERS.map(
  (layer) => ({
    layer,
    names: PLUGINS.filter((p) => p.layer === layer && !onlyBuiltin(p)).map((p) => p.name),
  }),
).filter((x) => x.names.length > 0);

function dotOf(p: Plugin): LineGridDot | undefined {
  if (p.health === "auto_off") return "danger";
  if (p.health === "failing") return "warning";
  return undefined;
}

/** 칸마다 글자 폭이 조금씩 다르게. 표의 모양만 보이면 된다. */
const BAR = ["w-12", "w-16", "w-10", "w-14"];

function barCell(r: number, c: number): LineGridItem[] {
  const n = (r * 3 + c * 5) % 7;
  const bar = <Skeleton className={`h-4 ${BAR[n % BAR.length] ?? "w-12"}`} />;
  return n === 0
    ? [
        { id: "a", label: bar },
        { id: "b", label: <Skeleton className="h-4 w-10" /> },
      ]
    : [{ id: "a", label: bar }];
}

const isLayer = (v: string) => TABLE_LAYERS.find((l) => l === v);
const isStage = (v: string) => STAGES.find((s) => s.id === v)?.id;

export function StructureGrid({
  look,
  pick,
  focus,
  transposed,
  onPick,
  onFocus,
}: {
  look: Look;
  pick: Pick;
  focus: string | null;
  transposed: boolean;
  onPick: (p: Pick) => void;
  onFocus: (id: string) => void;
}) {
  const related =
    focus === null ? null : new Set([focus, ...relationsOf(focus).map((r) => r.target)]);
  const stale = look === "offline";
  const items = (row: LayerId, col: StageId): LineGridItem[] => {
    if (look === "loading")
      return barCell(
        TABLE_LAYERS.indexOf(row),
        STAGES.findIndex((s) => s.id === col),
      );
    return pluginsAt(look, row, col).map((p) => {
      const dot = dotOf(p);
      return {
        id: p.id,
        label: p.name,
        ...(stale ? { muted: true } : {}),
        ...(dot === undefined ? {} : { dot }),
      };
    });
  };
  const hintOf = (l: LayerId) =>
    look === "safe-mode" && (l === "L3" || l === "X") ? "빠짐" : undefined;
  const select = (l: string | undefined, s: string | undefined) => {
    const row = l === undefined ? undefined : isLayer(l);
    const col = s === undefined ? undefined : isStage(s);
    onPick({ row, col });
  };
  const interactive = look !== "loading";
  const label = `${T.layer}과 ${T.step}`;

  if (transposed)
    return (
      <LineGrid
        label={label}
        density="compact"
        rowHeadWidth="5.5rem"
        groupBreaks={[]}
        rows={STAGES.map((s) => ({ id: s.id, label: s.label }))}
        columns={TABLE_LAYERS.map((l) => ({
          id: l,
          // 머리 칸은 한 줄로 자른다. 좁은 폭에서는 층 이름이 잘리지 않게 줄을 바꾼다.
          label: <span className="block break-keep whitespace-normal">{layerName(l)}</span>,
        }))}
        cell={(s, l) => {
          const row = isLayer(l);
          const col = isStage(s);
          return row === undefined || col === undefined ? null : { items: items(row, col) };
        }}
        selected={{ row: pick.col, col: pick.row }}
        {...(interactive
          ? {
              onSelect: (s: string, l: string) => select(l, s),
              onSelectRow: (s: string) => select(undefined, s),
              onSelectColumn: (l: string) => select(l, undefined),
              onItemSelect: (_s: string, _l: string, id: string) => onFocus(id),
            }
          : {})}
        {...(related === null
          ? {}
          : { focus: (_s: string, _l: string, id: string) => related.has(id) })}
      />
    );

  return (
    <LineGrid
      label={label}
      density="compact"
      style={{ minWidth: "880px" }}
      rowHeadWidth={ROW_HEAD}
      columns={STAGES.map((s) => ({ id: s.id, label: s.label }))}
      rows={TABLE_LAYERS.map((l) => {
        const hint = hintOf(l);
        return {
          id: l,
          group: l === "X" ? "x" : "layers",
          label: layerName(l),
          ...(hint === undefined ? {} : { hint }),
        };
      })}
      cell={(r, c) => {
        const row = isLayer(r);
        const col = isStage(c);
        return row === undefined || col === undefined ? null : { items: items(row, col) };
      }}
      selected={pick}
      {...(interactive
        ? {
            onSelect: (r: string, c: string) => select(r, c),
            onSelectRow: (r: string) => select(r, undefined),
            onSelectColumn: (c: string) => select(undefined, c),
            onItemSelect: (_r: string, _c: string, id: string) => onFocus(id),
          }
        : {})}
      {...(related === null
        ? {}
        : { focus: (_r: string, _c: string, id: string) => related.has(id) })}
    />
  );
}
