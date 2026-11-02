// 표 보기: 층(행) × 수명 단계(열) 선 격자. 칸 = 그 층에서 그 단계에 끼어들거나 일하는 플러그인.
// 단위를 고르면 그 단위의 칸이 밝아지고 나머지는 흐려지며, 비어 있되 더할 수 있는 칸에 더하기가 나온다.
import { LineGridBlock, LineGridCell } from "../_shell/line-grid";
import {
  ALLOWED,
  LAYERS,
  STAGES,
  litSet,
  pluginsAt,
  sameSelection,
  type LayerId,
  type Plugin,
  type Selection,
  type StageId,
  type Unit,
} from "./data";
import { useMock } from "./store";

const cn = (...p: Array<string | false | null | undefined>): string =>
  p.filter((x): x is string => typeof x === "string" && x !== "").join(" ");

function unitOfPlugin(p: Plugin): Unit {
  return p.kind === "group" ? { kind: "group", id: p.id } : { kind: "plugin", id: p.id };
}

function Chip({
  p,
  lit,
  dim,
  onPick,
}: {
  p: Plugin;
  lit: boolean;
  dim: boolean;
  onPick: (p: Plugin) => void;
}) {
  const m = useMock();
  const e = m.eff(p);
  const pickable = p.kind !== "contract";
  const state = p.health === "auto_off" ? "danger" : p.health === "failing" ? "warning" : null;
  return (
    <button
      type="button"
      disabled={!pickable}
      onClick={(ev) => {
        ev.stopPropagation();
        onPick(p);
      }}
      className={cn(
        "relative flex min-w-0 items-center gap-1.5 rounded-md py-0.5 text-start text-body outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]",
        pickable ? "cursor-pointer hover:underline" : "cursor-default",
        !e.on || dim ? "text-text-tertiary" : "text-text-primary",
        lit && "font-semibold text-text-primary",
      )}
    >
      {e.here && (
        <span
          role="img"
          aria-label="이 범위에서 바꿈"
          className="size-1.5 flex-none rounded-full bg-[var(--cs-color-accent-graphic)]"
        />
      )}
      <span className={cn("truncate", !e.on && e.from !== "default" && "line-through decoration-text-tertiary/60")}>{p.name}</span>
      {state !== null && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 flex-none rounded-full",
            state === "danger" ? "bg-danger-graphic" : "bg-warning-graphic",
          )}
        />
      )}
    </button>
  );
}

export function TableView() {
  const m = useMock();
  const lit = litSet(m.unit);
  const has = m.unit.kind !== "loop";
  const pick = (p: Plugin) => m.setUnit(unitOfPlugin(p));
  const sel = (s: Selection) => m.select(sameSelection(m.selection, s) ? null : s);

  const stageSel = (id: StageId) =>
    m.selection?.kind === "stage" && m.selection.stage === id;
  const layerSel = (id: LayerId) =>
    m.selection?.kind === "layer" && m.selection.layer === id;
  const cellSel = (l: LayerId, s: StageId) =>
    m.selection?.kind === "cell" && m.selection.layer === l && m.selection.stage === s;

  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="min-w-[700px]">
        <LineGridBlock
          marks={false}
          columns={`10rem repeat(${STAGES.length}, minmax(0, 1fr))`}
          aria-label="층 × 단계"
        >
          <LineGridCell head density="compact" className="items-end">
            <span className="text-footnote text-text-tertiary">층 · 단계</span>
          </LineGridCell>
          {STAGES.map((s) => (
            <LineGridCell
              key={s.id}
              head
              density="compact"
              selected={stageSel(s.id)}
              role="button"
              tabIndex={0}
              title={s.when}
              onClick={() => sel({ kind: "stage", stage: s.id })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  sel({ kind: "stage", stage: s.id });
                }
              }}
              className="cursor-pointer hover:bg-neutral-hover"
            >
              <span className="truncate text-title-3 text-text-primary">{s.label}</span>
            </LineGridCell>
          ))}
          {LAYERS.map((l) => (
            <LayerRow
              key={l.id}
              layer={l.id}
              has={has}
              lit={lit}
              pick={pick}
              layerSel={layerSel(l.id)}
              cellSel={cellSel}
              onLayer={() => sel({ kind: "layer", layer: l.id })}
              onCell={(s) => sel({ kind: "cell", layer: l.id, stage: s })}
            />
          ))}
        </LineGridBlock>
      </div>
    </div>
  );
}

function LayerRow({
  layer,
  has,
  lit,
  pick,
  layerSel,
  cellSel,
  onLayer,
  onCell,
}: {
  layer: LayerId;
  has: boolean;
  lit: ReadonlySet<string>;
  pick: (p: Plugin) => void;
  layerSel: boolean;
  cellSel: (l: LayerId, s: StageId) => boolean;
  onLayer: () => void;
  onCell: (s: StageId) => void;
}) {
  const m = useMock();
  const info = LAYERS.find((x) => x.id === layer);
  return (
    <>
      <LineGridCell
        head
        density="compact"
        selected={layerSel}
        role="button"
        tabIndex={0}
        title={info?.does}
        onClick={onLayer}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onLayer();
          }
        }}
        className="cursor-pointer hover:bg-neutral-hover"
      >
        <span className="min-w-0 truncate text-title-3 text-text-primary">{info?.name}</span>
        <span className="ms-auto flex-none text-footnote text-text-tertiary">{layer}</span>
      </LineGridCell>
      {STAGES.map((s) => {
        const items = pluginsAt(layer, s.id);
        const mine = items.some((p) => lit.has(p.id));
        const allowed = ALLOWED[layer].includes(s.id);
        const selected = cellSel(layer, s.id);
        const common = {
          density: "compact" as const,
          role: "gridcell",
          onClick: () => onCell(s.id),
        };
        if (items.length === 0) {
          return (
            <LineGridCell
              key={s.id}
              {...common}
              className={cn(
                "group line-cell-hatch flex items-center justify-center",
                allowed && "cursor-pointer",
                selected && "outline outline-1 -outline-offset-1 outline-[var(--cs-color-accent-graphic)]",
              )}
            >
              {allowed && (
                <button
                  type="button"
                  aria-label={`${info?.name} · ${s.label} 더하기`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    m.openBuilder(
                      { layer, stage: s.id },
                      layer === "L3" ? "drive" : null,
                    );
                  }}
                  className={cn(
                    "cursor-pointer rounded-md bg-bg-app px-2 py-0.5 text-footnote text-text-secondary outline-none shadow-[inset_0_0_0_1px_var(--cs-color-border-default)] focus-visible:opacity-100 focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]",
                    has ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  + 더하기
                </button>
              )}
            </LineGridCell>
          );
        }
        return (
          <LineGridCell
            key={s.id}
            {...common}
            selected={selected || (has && mine)}
            className={cn(
              "grid cursor-pointer content-start gap-0.5",
              selected && "outline outline-1 -outline-offset-1 outline-[var(--cs-color-accent-graphic)]",
              has && mine && !selected && "outline outline-1 -outline-offset-1 outline-[var(--cs-color-accent-graphic)]/40",
            )}
          >
            {items.map((p) => (
              <Chip
                key={p.id}
                p={p}
                lit={has && lit.has(p.id)}
                dim={has && !lit.has(p.id)}
                onPick={pick}
              />
            ))}
          </LineGridCell>
        );
      })}
    </>
  );
}
