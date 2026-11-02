import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ALLOWED,
  LAYERS,
  STAGES,
  hooksAtStage,
  pluginsAt,
  sameSelection,
  stageOfPoint,
  type HookRef,
  type LayerId,
  type Plugin,
  type Selection,
  type Stage,
  type StageId,
} from "./data";

export interface LoopViewProps {
  /** ids of plugins lit by the selected unit. Empty set with hasUnit=false means "whole loop": nothing dimmed. */
  lit: ReadonlySet<string>;
  /** true when a group or a plugin is the selected unit: lit things are accent, everything else is dimmed (text-tertiary, lighter lines). */
  hasUnit: boolean;
  /** effective on/off of a plugin at the selected scope. Off plugins are drawn dimmed: text-tertiary and a hairline dashed outline. */
  isOn: (pluginId: string) => boolean;
  /** true when the plugin's on/off is set by the selected scope itself (override): a small 5px accent dot at the top-left of its chip. */
  isHere: (pluginId: string) => boolean;
  selected: Selection | null;
  onSelect: (s: Selection) => void;
  /** a plugin chip in the layer stack was pressed: make it the unit */
  onPick: (pluginId: string) => void;
  /** an empty allowed spot in the layer stack was pressed */
  onAdd: (layer: LayerId, stage: StageId) => void;
}

// 색은 모두 CSS 변수다. 선 굵기는 1(헤어라인), 면은 페이지 배경과 강조 중립색, 그리고 점(강조·경고·위험)만 쓴다.
const C = {
  subtle: "var(--cs-color-border-subtle)",
  line: "var(--cs-color-border-default)",
  primary: "var(--cs-color-text-primary)",
  tertiary: "var(--cs-color-text-tertiary)",
  accent: "var(--cs-color-accent-graphic)",
  accentText: "var(--cs-color-accent-text)",
  warn: "var(--cs-color-warning-graphic)",
  danger: "var(--cs-color-danger-graphic)",
  hover: "var(--cs-color-neutral-hover)",
  bg: "var(--cs-color-bg-app)",
};

// 기하(viewBox 1000×640). 단계 기둥 x_i = 175 + i·110.
const STEP_W = 110;
const xOf = (i: number): number => 175 + i * STEP_W;
/** 단계 사이 가운데 x(꺾쇠 자리) */
const GAP_XS: number[] = Array.from({ length: 6 }, (_, i) => xOf(i) + STEP_W / 2);
const LOOP_TOP = 80;
const LOOP_BOTTOM = 200;
const GUIDE_TOP = 97;
const GUIDE_BOTTOM = 614;
const BAND_TOP = 250;
const BAND_H = 52;
const bandY = (j: number): number => BAND_TOP + j * BAND_H;
const bandMid = (j: number): number => bandY(j) + BAND_H / 2;
const CELL_W = 96;
const CELL_H = 40;
const PIN_MAX = 4;
const pinY = (k: number): number => 110 + k * 18;
const CYCLE_Y = 182;
/** 오른쪽 곡선이 y=97을 지나는 x. 수명 연결선의 끝. */
const TIE_X = 880 + Math.sqrt(60 * 60 - 43 * 43);
const ELLIPSIS_PX = 12;

/** 칩·핀 이름: max 글자를 넘으면 "…"으로 줄인다. */
const truncate = (name: string, max: number): string => (name.length > max ? `${name.slice(0, max)}…` : name);

/** 층 이름을 라벨 칸 폭(maxPx) 안에 맞춘다. 12px 기준 글자 폭: 한글 12, 공백 3, ASCII 7. 넘치면 끝을 "…"으로 줄인다. */
function fitRowName(name: string, maxPx: number): string {
  const chars = Array.from(name);
  const widthOf = (ch: string): number => {
    if (ch === " ") return 3;
    return ch.charCodeAt(0) < 128 ? 7 : 12;
  };
  if (chars.reduce((sum, ch) => sum + widthOf(ch), 0) <= maxPx) return name;
  let out = "";
  let used = 0;
  for (const ch of chars) {
    const w = widthOf(ch);
    if (used + w + ELLIPSIS_PX > maxPx) break;
    out += ch;
    used += w;
  }
  return `${out.trimEnd()}…`;
}

/** 6px 열린 꺾쇠. (cx, cy)가 가운데이고 뾰족한 쪽이 방향이다. */
const chevronRight = (cx: number, cy: number): string => `M ${cx - 3} ${cy - 3} L ${cx + 3} ${cy} L ${cx - 3} ${cy + 3}`;
const chevronLeft = (cx: number, cy: number): string => `M ${cx + 3} ${cy - 3} L ${cx - 3} ${cy} L ${cx + 3} ${cy + 3}`;
const chevronDown = (cx: number, cy: number): string => `M ${cx - 3} ${cy - 3} L ${cx} ${cy + 3} L ${cx + 3} ${cy - 3}`;
const chevronUp = (cx: number, cy: number): string => `M ${cx - 3} ${cy + 3} L ${cx} ${cy - 3} L ${cx + 3} ${cy + 3}`;

/** Enter와 Space로 누른다(버튼 역할 <g>용). */
const onKeys =
  (run: () => void) =>
  (e: KeyboardEvent): void => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    run();
  };

/** 고른 것이 걸린 단계. 단계·칸은 그 단계, 훅은 훅이 걸린 단계, 층은 없음. */
function selectedStage(sel: Selection | null): StageId | null {
  if (sel === null) return null;
  if (sel.kind === "stage" || sel.kind === "cell") return sel.stage;
  if (sel.kind === "hook") return stageOfPoint(sel.point);
  return null;
}

/** 칩 글자색: 꺼짐·흐림은 연한 글자, 단위가 밝힌 칩은 강조 글자, 그 밖은 본문 글자. */
function chipTextColor(on: boolean, dim: boolean, lit: boolean): string {
  if (!on || dim) return C.tertiary;
  if (lit) return C.accentText;
  return C.primary;
}

interface PinColors {
  fill: string;
  stroke: string;
  text: string;
  leader: string;
}
/** 핀 색: 단위가 밝히면 강조 채움, 흐림이면 속 빈 연한 원, 보통이면 속 빈 본문색 원. */
function pinColors(lit: boolean, dim: boolean, on: boolean): PinColors {
  if (lit) return { fill: on ? C.accent : C.bg, stroke: C.accent, text: C.accentText, leader: C.accent };
  if (dim) return { fill: C.bg, stroke: C.tertiary, text: C.tertiary, leader: C.subtle };
  return { fill: C.bg, stroke: on ? C.primary : C.tertiary, text: on ? C.primary : C.tertiary, leader: C.line };
}

const keyOf = (layer: LayerId, stage: StageId): string => `${layer}:${stage}`;

interface StageNodeProps {
  stage: Stage;
  x: number;
  selected: boolean;
  onSelect: (s: Selection) => void;
}

function StageNode({ stage, x, selected, onSelect }: StageNodeProps): ReactNode {
  const pick = (): void => onSelect({ kind: "stage", stage: stage.id });
  // 대화·수명은 단계 고리 밖이라 점선 테두리
  const outside = stage.id === "thread" || stage.id === "lifecycle";
  return (
    <g role="button" tabIndex={0} aria-label={stage.label} style={{ cursor: "pointer" }} onClick={pick} onKeyDown={onKeys(pick)}>
      <rect
        x={x - 50}
        y={63}
        width={100}
        height={34}
        rx={8}
        strokeWidth={1}
        strokeDasharray={outside ? "3 2" : undefined}
        style={{ fill: selected ? C.hover : C.bg, stroke: selected ? C.accent : C.line }}
      />
      <text
        x={x}
        y={80}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="inherit"
        fontSize={12}
        fontWeight={600}
        style={{ fill: C.primary }}
      >
        {stage.label}
      </text>
    </g>
  );
}

interface PinProps {
  item: HookRef;
  x: number;
  y: number;
  lit: boolean;
  /** 단위가 있는데 이 훅의 플러그인이 그 단위가 아님: 흐린 핀, 이름 없음 */
  dim: boolean;
  on: boolean;
  selected: boolean;
  onSelect: (s: Selection) => void;
}

function Pin({ item, x, y, lit, dim, on, selected, onSelect }: PinProps): ReactNode {
  const { plugin, hook } = item;
  const title = `${plugin.name} · ${hook.point}`;
  const pick = (): void => onSelect({ kind: "hook", plugin: plugin.id, point: hook.point });
  const col = pinColors(lit, dim, on);
  return (
    <>
      <line x1={x} y1={GUIDE_TOP} x2={x} y2={y - 5} strokeWidth={1} style={{ stroke: col.leader }} />
      <g role="button" tabIndex={0} aria-label={title} style={{ cursor: "pointer" }} onClick={pick} onKeyDown={onKeys(pick)}>
        <title>{title}</title>
        <circle cx={x} cy={y} r={9} fill="none" pointerEvents="all" />
        {selected ? <circle cx={x} cy={y} r={9} fill="none" strokeWidth={1} style={{ stroke: C.accent }} /> : null}
        <circle
          cx={x}
          cy={y}
          r={5}
          strokeWidth={1}
          strokeDasharray={on ? undefined : "2 2"}
          style={{ fill: col.fill, stroke: col.stroke }}
        />
        {(hook.fails ?? 0) > 0 ? <circle cx={x + 5} cy={y - 5} r={2.5} style={{ fill: C.danger }} /> : null}
        {dim ? null : (
          <text x={x + 9} y={y} dominantBaseline="central" fontFamily="inherit" fontSize={11} style={{ fill: col.text }}>
            {truncate(plugin.name, 7)}
          </text>
        )}
      </g>
    </>
  );
}

interface ChipProps {
  plugin: Plugin;
  /** 칸의 가운데 x */
  x: number;
  /** 칩 윗변 */
  top: number;
  lit: boolean;
  /** 단위가 있는데 이 칩이 그 단위가 아님: 흐림 */
  dim: boolean;
  on: boolean;
  here: boolean;
  onPick: (pluginId: string) => void;
}

function Chip({ plugin, x, top, lit, dim, on, here, onPick }: ChipProps): ReactNode {
  const left = x - CELL_W / 2;
  const pick = (): void => onPick(plugin.id);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={plugin.name}
      style={{ cursor: "pointer" }}
      opacity={dim ? 0.6 : undefined}
      onClick={pick}
      onKeyDown={onKeys(pick)}
    >
      <title>{plugin.name}</title>
      <rect
        x={left}
        y={top}
        width={CELL_W}
        height={19}
        rx={4}
        strokeWidth={1}
        strokeDasharray={on ? undefined : "3 2"}
        style={{ fill: lit ? C.hover : C.bg, stroke: lit ? C.accent : C.subtle }}
      />
      <text
        x={x}
        y={top + 9.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="inherit"
        fontSize={11}
        style={{ fill: chipTextColor(on, dim, lit) }}
      >
        {truncate(plugin.name, 7)}
      </text>
      {here ? <circle cx={left + 3} cy={top + 3} r={2.5} style={{ fill: C.accent }} /> : null}
      {plugin.health === "failing" ? (
        <circle cx={left + CELL_W - 3} cy={top + 3} r={2.5} style={{ fill: C.warn }} />
      ) : null}
      {plugin.health === "auto_off" ? (
        <circle cx={left + CELL_W - 3} cy={top + 3} r={2.5} style={{ fill: C.danger }} />
      ) : null}
    </g>
  );
}

interface AddSpotProps {
  /** 칸의 가운데 x */
  cx: number;
  /** 칸 윗변 */
  top: number;
  label: string;
  hovered: boolean;
  hasUnit: boolean;
  onAdd: () => void;
  onHover: (on: boolean) => void;
}

/** 비어 있고 더할 수 있는 칸. 평소엔 안 보이고, 단위가 고른 때 흐리게, 가리키거나 초점이 오면 또렷하게 + 를 보인다. */
function AddSpot({ cx, top, label, hovered, hasUnit, onAdd, onHover }: AddSpotProps): ReactNode {
  const cy = top + CELL_H / 2;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      style={{ cursor: "pointer" }}
      onClick={onAdd}
      onKeyDown={onKeys(onAdd)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <rect x={cx - CELL_W / 2} y={top} width={CELL_W} height={CELL_H} fill="none" pointerEvents="all" />
      {hovered || hasUnit ? (
        <g pointerEvents="none" opacity={hovered ? undefined : 0.7} style={{ stroke: C.tertiary }}>
          <line x1={cx - 4} x2={cx + 4} y1={cy} y2={cy} strokeWidth={1} />
          <line x1={cx} x2={cx} y1={cy - 4} y2={cy + 4} strokeWidth={1} />
        </g>
      ) : null}
    </g>
  );
}

export function LoopView(props: LoopViewProps): ReactNode {
  const { lit, hasUnit, isOn, isHere, selected, onSelect, onPick, onAdd } = props;
  const [hover, setHover] = useState<string | null>(null);

  const isLit = (id: string): boolean => hasUnit && lit.has(id);
  const loopLine = hasUnit ? C.subtle : C.line;
  const stageOfGuide = selectedStage(selected);

  const layerSelected = (layer: LayerId): boolean =>
    selected !== null && selected.kind === "layer" && selected.layer === layer;
  const cellSelected = (layer: LayerId, stage: StageId): boolean =>
    selected !== null && selected.kind === "cell" && selected.layer === layer && selected.stage === stage;
  const nodeSelected = (stage: StageId): boolean =>
    selected !== null && (selected.kind === "stage" || selected.kind === "cell") && selected.stage === stage;

  /** 칸의 플러그인. 단위가 있으면 단위가 밝히는 것을 앞에 둔다(두 칸 안에 보이도록). */
  const cellPlugins = (layer: LayerId, stage: StageId): Plugin[] => {
    const pl = pluginsAt(layer, stage);
    if (!hasUnit) return pl;
    return [...pl].sort((a, b) => Number(isLit(b.id)) - Number(isLit(a.id)));
  };
  /** 단위가 닿는 층 줄(0 = L4 … 6 = F) */
  const litRows = (stage: StageId): number[] =>
    LAYERS.flatMap((l, j) => (pluginsAt(l.id, stage).some((p) => isLit(p.id)) ? [j] : []));

  return (
    <svg viewBox="0 0 1000 640" className="block w-full h-auto" role="group" aria-label="루프">
      <defs>
        <pattern id="loop-hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={3} y1={0} x2={3} y2={6} strokeWidth={1} style={{ stroke: C.subtle }} />
        </pattern>
      </defs>

      {/* 1. 고른 층·칸의 배경 */}
      {LAYERS.map((layer, j) => (
        <g key={layer.id}>
          {layerSelected(layer.id) ? (
            <rect x={20} y={bandY(j)} width={960} height={BAND_H} style={{ fill: C.hover }} pointerEvents="none" />
          ) : null}
          {STAGES.map((stage, i) =>
            cellSelected(layer.id, stage.id) ? (
              <rect
                key={stage.id}
                x={xOf(i) - 50}
                y={bandY(j) + 4}
                width={100}
                height={44}
                rx={6}
                style={{ fill: C.hover }}
                pointerEvents="none"
              />
            ) : null,
          )}
        </g>
      ))}

      {/* 2. 층 띠의 가로 선. 띠 묶음이 바뀌는 곳은 진하게 */}
      {LAYERS.map((layer, j) => {
        const heavy = j > 0 && LAYERS[j - 1]?.band !== layer.band;
        return (
          <line
            key={layer.id}
            x1={20}
            x2={980}
            y1={bandY(j)}
            y2={bandY(j)}
            strokeWidth={1}
            style={{ stroke: heavy ? C.line : C.subtle }}
          />
        );
      })}
      <line
        x1={20}
        x2={980}
        y1={bandY(LAYERS.length)}
        y2={bandY(LAYERS.length)}
        strokeWidth={1}
        style={{ stroke: C.subtle }}
      />

      {/* 3. 단계 안내선. 고른 단계의 선은 진하고 실선 */}
      {STAGES.map((stage, i) => {
        const solid = stageOfGuide === stage.id;
        return (
          <line
            key={stage.id}
            x1={xOf(i)}
            x2={xOf(i)}
            y1={GUIDE_TOP}
            y2={GUIDE_BOTTOM}
            strokeWidth={1}
            strokeDasharray={solid ? undefined : "2 4"}
            style={{ stroke: solid ? C.line : C.subtle }}
          />
        );
      })}
      {/* 3-1. 단위가 닿는 단계: 루프에서 가장 아래 닿는 층까지 강조 선 */}
      {STAGES.map((stage, i) => {
        const rows = litRows(stage.id);
        if (rows.length === 0) return null;
        const low = rows.reduce((a, b) => Math.max(a, b), 0);
        return (
          <line
            key={stage.id}
            x1={xOf(i)}
            x2={xOf(i)}
            y1={GUIDE_TOP}
            y2={bandMid(low)}
            strokeWidth={1}
            style={{ stroke: C.accent }}
          />
        );
      })}

      {/* 4. 턴 루프: 위 단계 줄, 오른쪽 아래로 굽고, 아래 줄을 거꾸로, 왼쪽 위로 */}
      <path
        d="M 120 80 H 880 A 60 60 0 0 1 880 200 H 120 A 60 60 0 0 1 120 80 Z"
        fill="none"
        strokeWidth={1}
        style={{ stroke: loopLine }}
      />
      {GAP_XS.map((gx) => (
        <g key={gx}>
          <path d={chevronRight(gx, LOOP_TOP)} fill="none" strokeWidth={1} style={{ stroke: loopLine }} />
          <path d={chevronLeft(gx, LOOP_BOTTOM)} fill="none" strokeWidth={1} style={{ stroke: loopLine }} />
        </g>
      ))}
      <line
        x1={xOf(6) + 42}
        x2={TIE_X}
        y1={GUIDE_TOP}
        y2={GUIDE_TOP}
        strokeWidth={1}
        strokeDasharray="2 2"
        style={{ stroke: loopLine }}
      />
      <text
        x={500}
        y={222}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="inherit"
        fontSize={11}
        pointerEvents="none"
        style={{ fill: C.tertiary }}
      >
        다음 턴
      </text>

      {/* 5. 다음 단계 고리: 단계 기둥에서 모델 요청으로 돌아오는 위쪽 호 */}
      <path
        d={`M ${xOf(5)} 63 C ${xOf(5)} 16.33 ${xOf(2)} 16.33 ${xOf(2)} 63`}
        fill="none"
        strokeWidth={1}
        style={{ stroke: C.tertiary }}
      />
      <path d={chevronDown(xOf(2), 60)} fill="none" strokeWidth={1} style={{ stroke: C.tertiary }} />
      <text
        x={(xOf(5) + xOf(2)) / 2}
        y={17}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="inherit"
        fontSize={11}
        pointerEvents="none"
        style={{ fill: C.tertiary }}
      >
        다음 단계
      </text>

      {/* 5-1. 단계 그림(장식): 세 점과 아래로 돌아오는 화살 */}
      {[580, 620].map((cx) => (
        <g key={cx}>
          <line x1={cx + 8} x2={cx + 32} y1={CYCLE_Y} y2={CYCLE_Y} strokeWidth={1} style={{ stroke: C.tertiary }} />
          <path d={chevronRight(cx + 29, CYCLE_Y)} fill="none" strokeWidth={1} style={{ stroke: C.tertiary }} />
        </g>
      ))}
      {[580, 620, 660].map((cx) => (
        <circle key={cx} cx={cx} cy={CYCLE_Y} r={7} strokeWidth={1} style={{ fill: C.bg, stroke: C.tertiary }} />
      ))}
      <path d="M 660 189 Q 620 195 580 189" fill="none" strokeWidth={1} style={{ stroke: C.tertiary }} />
      <path d={chevronUp(580, 192)} fill="none" strokeWidth={1} style={{ stroke: C.tertiary }} />

      {/* 6. 단계 머리(노드): 루프 윗줄 위에 놓는다 */}
      {STAGES.map((stage, i) => (
        <StageNode
          key={stage.id}
          stage={stage}
          x={xOf(i)}
          selected={nodeSelected(stage.id)}
          onSelect={onSelect}
        />
      ))}

      {/* 7. 훅 핀: 단계 머리 밑에서 루프 안쪽으로 매달린다(최대 4개) */}
      {STAGES.map((stage, i) => (
        <g key={stage.id}>
          {hooksAtStage(stage.id)
            .slice(0, PIN_MAX)
            .map((item, k) => {
              const id = item.plugin.id;
              const litNow = isLit(id);
              return (
                <Pin
                  key={`${id}:${item.hook.point}`}
                  item={item}
                  x={xOf(i)}
                  y={pinY(k)}
                  lit={litNow}
                  dim={hasUnit && !litNow}
                  on={isOn(id)}
                  selected={sameSelection(selected, { kind: "hook", plugin: id, point: item.hook.point })}
                  onSelect={onSelect}
                />
              );
            })}
        </g>
      ))}

      {/* 8. 층 쌓기: 칸마다 칩, 빈 칸은 더하기 자리나 빗금 */}
      {LAYERS.map((layer, j) => (
        <g key={layer.id}>
          {STAGES.map((stage, i) => {
            const x = xOf(i);
            const top = bandY(j) + 6;
            const pl = cellPlugins(layer.id, stage.id);
            if (pl.length === 0) {
              if (!ALLOWED[layer.id].includes(stage.id)) {
                return (
                  <rect
                    key={stage.id}
                    x={x - CELL_W / 2}
                    y={top}
                    width={CELL_W}
                    height={CELL_H}
                    fill="url(#loop-hatch)"
                    pointerEvents="none"
                  />
                );
              }
              const hk = keyOf(layer.id, stage.id);
              return (
                <AddSpot
                  key={stage.id}
                  cx={x}
                  top={top}
                  label={`${layer.name} · ${stage.label} 더하기`}
                  hovered={hover === hk}
                  hasUnit={hasUnit}
                  onAdd={() => onAdd(layer.id, stage.id)}
                  onHover={(on) => setHover(on ? hk : null)}
                />
              );
            }
            // 플러그인이 셋 이상이면 칩은 하나만 보이고 두 번째 칸은 "+N"(나머지 수)
            const many = pl.length > 2;
            const shown = many ? pl.slice(0, 1) : pl;
            return (
              <g key={stage.id}>
                {shown.map((p, k) => (
                  <Chip
                    key={p.id}
                    plugin={p}
                    x={x}
                    top={top + k * 21}
                    lit={isLit(p.id)}
                    dim={hasUnit && !isLit(p.id)}
                    on={isOn(p.id)}
                    here={isHere(p.id)}
                    onPick={onPick}
                  />
                ))}
                {many ? (
                  <text
                    x={x}
                    y={top + 30.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontFamily="inherit"
                    fontSize={11}
                    pointerEvents="none"
                    style={{ fill: C.tertiary }}
                  >
                    {`+${pl.length - 1}`}
                  </text>
                ) : null}
                {pl.some((p) => isLit(p.id)) ? (
                  <circle cx={x} cy={bandMid(j)} r={3} pointerEvents="none" style={{ fill: C.accent }} />
                ) : null}
              </g>
            );
          })}
        </g>
      ))}

      {/* 9. 층 이름(행 머리): 누르면 그 층을 고른다 */}
      {LAYERS.map((layer, j) => {
        const pick = (): void => onSelect({ kind: "layer", layer: layer.id });
        return (
          <g
            key={layer.id}
            role="button"
            tabIndex={0}
            aria-label={layer.name}
            style={{ cursor: "pointer" }}
            onClick={pick}
            onKeyDown={onKeys(pick)}
          >
            <title>{layer.name}</title>
            <rect x={20} y={bandY(j)} width={100} height={BAND_H} fill="none" pointerEvents="all" />
            <text x={28} y={bandY(j) + 22} fontFamily="inherit" fontSize={12} fontWeight={600} style={{ fill: C.primary }}>
              {fitRowName(layer.name, 94)}
            </text>
            <text x={28} y={bandY(j) + 38} fontFamily="inherit" fontSize={11} style={{ fill: C.tertiary }}>
              {layer.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
