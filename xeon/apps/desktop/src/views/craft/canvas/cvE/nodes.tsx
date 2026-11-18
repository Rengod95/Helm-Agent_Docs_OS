// cvE의 노드. 모양이 붙는 방식을 말한다(색은 거든다): Inject 알약(고리 안), Hook 문 카드(지점 바깥), 도구 소켓 타일, Drive 고리.
// 베이스는 뒤에 판 한 장이 겹쳐 보이고(모든 프로필에 깔린다), 드래프트는 점선 테두리와 "리뷰 대기"다.
// 노드는 세계 좌표 층 위의 단추다: 누르면 고르고, 두 번 누르거나 Enter면 안으로 들어간다. 끌면 자리 안 순서를 바꾼다.
import { t } from "@fresnel/client/i18n";
import { cn } from "@caustic/react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { DecisionGlyph, KindGlyph } from "./glyphs.tsx";
import { SIZE, STATION_ANGLE, RING, polar, type PlacedNode } from "./layout.ts";
import type { Group, Kind, PluginDef, StationId } from "./model.ts";
import { DECISION_TEXT, givesText, nameText, STATION_TEXT, usedText } from "./text.ts";

/** 종류의 색(캐릭터 토큰). 표식과 선 끝에만 쓴다: 면은 무채색이다 */
export const KIND_COLOR: Readonly<Record<Kind, string>> = {
  inject: "var(--cs-color-identity-iris)",
  hook: "var(--cs-color-identity-amber)",
  tool: "var(--cs-color-identity-slate)",
  drive: "var(--cs-color-identity-mint)",
};

export interface NodeHandlers {
  readonly onSelect: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLElement>, id: string) => void;
  readonly onPointerDown: (e: PointerEvent<HTMLElement>, id: string) => void;
}

interface NodeProps {
  readonly node: PlacedNode;
  readonly def: PluginDef;
  readonly base: boolean;
  readonly start: boolean;
  readonly group: Group | undefined;
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly lifted: boolean;
  readonly label: string;
  readonly h: NodeHandlers;
}

function boxStyle(n: PlacedNode, w: number, h: number): CSSProperties {
  return { left: n.c.x - w / 2, top: n.c.y - h / 2, width: w, height: h };
}

/** 베이스: 오른쪽 아래로 판 한 장이 겹친다(그림자 둘. 테두리 선과 면) */
const BASE_PLATE =
  "shadow-[4px_4px_0_-1px_var(--cs-color-surface-raised),4px_4px_0_0_var(--cve-line)]";

const SURFACE =
  "border bg-surface-raised text-text-primary transition-[border-color,opacity,box-shadow] duration-quick ease-out";

function stateClass(p: NodeProps): string {
  return cn(
    p.def.draft === true || p.def.unread === true
      ? "border-dashed border-border-strong bg-[color-mix(in_oklab,var(--cs-color-surface-raised)_55%,transparent)]"
      : "border-[var(--cve-line)] hover:border-border-strong",
    p.base && BASE_PLATE,
    p.selected && "outline-2 outline-offset-2 outline-[var(--cs-color-canvas-selection)]",
    p.dimmed && "opacity-40",
    p.lifted && "opacity-30",
  );
}

function common(p: NodeProps): {
  readonly "data-cve-node": string;
  readonly "aria-label": string;
  readonly "aria-pressed": boolean;
  readonly onClick: () => void;
  readonly onDoubleClick: () => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
} {
  const id = p.node.id;
  return {
    "data-cve-node": id,
    "aria-label": p.label,
    "aria-pressed": p.selected,
    onClick: () => {
      p.h.onSelect(id);
    },
    onDoubleClick: () => {
      p.h.onOpen(id);
    },
    onKeyDown: (e) => {
      p.h.onKeyDown(e, id);
    },
    onPointerDown: (e) => {
      p.h.onPointerDown(e, id);
    },
  };
}

const NAME = "truncate font-mono text-mono text-text-primary";
const SUB = "flex min-w-0 items-center gap-1 truncate text-caption text-text-tertiary";

function DraftLine(): ReactNode {
  return (
    <span className={cn(SUB, "text-text-secondary")}>
      <span className="rounded-xs border border-dashed border-border-strong px-1 leading-3.5">
        {t("desktop.craft.canvas.cvE.draft")}
      </span>
      {t("desktop.craft.canvas.cvE.review")}
    </span>
  );
}

export function HookNode(p: NodeProps): ReactNode {
  const { def } = p;
  return (
    <button
      type="button"
      {...common(p)}
      style={boxStyle(p.node, SIZE.hook.x, SIZE.hook.y)}
      className={cn(
        SURFACE,
        "absolute flex cursor-pointer items-center gap-2 rounded-lg ps-0 pe-2.5 text-start outline-none focus-visible:focus-ring",
        stateClass(p),
      )}
    >
      {/* 문: 길(가로선) 위에 선 두 기둥. 왼쪽 끝 세로 띠가 Hook의 색이다 */}
      <span
        aria-hidden
        className="flex h-full w-8 flex-none items-center justify-center rounded-s-[9px] border-e border-[var(--cve-line)]"
        style={{ color: KIND_COLOR.hook, background: "var(--cve-hook-tint)" }}
      >
        <KindGlyph kind="hook" size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={NAME}>{def.id}</span>
        {def.draft === true ? (
          <DraftLine />
        ) : (
          <span className={SUB}>
            {def.decision === undefined ? null : (
              <>
                <DecisionGlyph
                  decision={def.decision}
                  size={12}
                  className="flex-none text-text-secondary"
                />
                <span className="text-text-secondary">{t(DECISION_TEXT[def.decision])}</span>
              </>
            )}
            {def.usedMin === undefined ? null : <span>· {usedText(def.usedMin)}</span>}
          </span>
        )}
      </span>
      {def.guard === true ? <GuardMark /> : null}
    </button>
  );
}

/** 가드 등급: 오른쪽 위 작은 방패 테(색 없음). 같은 지점에서 먼저 돈다 */
function GuardMark(): ReactNode {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 16 16"
      className="flex-none self-start mt-2 text-text-tertiary"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path d="M8 1.8 13 3.8v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z" />
    </svg>
  );
}

export function InjectNode(p: NodeProps): ReactNode {
  const { def } = p;
  return (
    <button
      type="button"
      {...common(p)}
      style={boxStyle(p.node, SIZE.inject.x, SIZE.inject.y)}
      className={cn(
        SURFACE,
        "absolute flex cursor-pointer items-center gap-2 rounded-full ps-1 pe-3 text-start outline-none focus-visible:focus-ring",
        stateClass(p),
      )}
    >
      <span
        aria-hidden
        className="flex size-6.5 flex-none items-center justify-center rounded-full"
        style={{
          color: def.unread === true ? "var(--cs-color-text-tertiary)" : KIND_COLOR.inject,
          background: "var(--cve-inject-tint)",
        }}
      >
        <KindGlyph kind="inject" size={14} />
      </span>
      <span className={cn(NAME, "flex-1")}>{def.id}</span>
      {def.gives === undefined ? null : (
        <span className="flex-none text-caption text-text-tertiary">
          {givesText(def.gives.what, def.gives.count)}
        </span>
      )}
    </button>
  );
}

export function ToolNode(p: NodeProps): ReactNode {
  const { def, node } = p;
  const s = SIZE.tool;
  return (
    <button
      type="button"
      {...common(p)}
      style={{ left: node.c.x - 50, top: node.c.y - s.y / 2, width: 100, height: s.y + 22 }}
      className={cn(
        "group absolute flex cursor-pointer flex-col items-center gap-1 rounded-xl border-0 bg-transparent p-0 outline-none",
        p.dimmed && "opacity-40",
        p.lifted && "opacity-30",
      )}
    >
      {/* 소켓: 네모 타일에 두 갈래 꽂개. 꽂힌 도구 수가 오른쪽 위에 */}
      <span
        aria-hidden
        className={cn(
          SURFACE,
          "relative flex size-15 items-center justify-center rounded-[14px] border-[var(--cve-line)] group-hover:border-border-strong group-focus-visible:focus-ring",
          p.base && BASE_PLATE,
          p.selected && "outline-2 outline-offset-2 outline-[var(--cs-color-canvas-selection)]",
        )}
        style={{ color: KIND_COLOR.tool }}
      >
        <KindGlyph kind="tool" size={22} />
        {def.gives === undefined ? null : (
          <span className="absolute -end-1.5 -top-1.5 min-w-5 rounded-full border border-[var(--cve-line)] bg-bg-canvas px-1 text-center font-mono text-mono-sm text-text-secondary">
            {def.gives.count}
          </span>
        )}
      </span>
      <span className="max-w-full truncate font-mono text-mono-sm text-text-secondary">
        {def.id}
      </span>
    </button>
  );
}

/** Drive: 고리 자체가 노드다(고리는 아래 SVG 층이 그린다). 가운데 이름과 스타트 Drive 표시 */
export function DriveNode(p: NodeProps): ReactNode {
  const { def, node } = p;
  const r = node.r ?? 60;
  return (
    <button
      type="button"
      {...common(p)}
      style={{ left: node.c.x - r, top: node.c.y - r, width: r * 2, height: r * 2 }}
      className={cn(
        "absolute flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border-0 bg-transparent p-0 outline-none focus-visible:focus-ring transition-opacity duration-quick",
        p.selected && "outline-2 outline-offset-4 outline-[var(--cs-color-canvas-selection)]",
        p.dimmed && "opacity-40",
        p.lifted && "opacity-30",
      )}
    >
      <span className={cn(NAME, "max-w-[80%]")}>{def.id}</span>
      {p.start ? (
        <span className="text-caption text-text-secondary">
          {t("desktop.craft.canvas.cvE.startDrive")}
        </span>
      ) : def.usedMin === undefined ? null : (
        <span className="text-caption text-text-tertiary">{usedText(def.usedMin)}</span>
      )}
    </button>
  );
}

export function BundleNode(props: {
  readonly node: PlacedNode;
  readonly group: Group;
  readonly kinds: readonly Kind[];
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly label: string;
  readonly h: NodeHandlers;
}): ReactNode {
  const { node, group } = props;
  const s = SIZE.bundle;
  return (
    <button
      type="button"
      data-cve-node={node.id}
      aria-label={props.label}
      aria-pressed={props.selected}
      onClick={() => {
        props.h.onSelect(node.id);
      }}
      onDoubleClick={() => {
        props.h.onOpen(node.id);
      }}
      onKeyDown={(e) => {
        props.h.onKeyDown(e, node.id);
      }}
      style={boxStyle(node, s.x, s.y)}
      className={cn(
        SURFACE,
        "absolute flex cursor-pointer items-center gap-2.5 rounded-xl border-[var(--cve-line)] ps-3 pe-3 text-start outline-none focus-visible:focus-ring hover:border-border-strong",
        "shadow-[5px_-5px_0_-1px_var(--cs-color-surface-raised),5px_-5px_0_0_var(--cve-line),10px_-10px_0_-1px_var(--cs-color-surface-raised),10px_-10px_0_0_var(--cve-line)]",
        props.selected && "outline-2 outline-offset-2 outline-[var(--cs-color-canvas-selection)]",
        props.dimmed && "opacity-40",
      )}
    >
      <KindGlyph kind="bundle" size={16} className="flex-none text-text-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui font-medium text-text-primary">
          {nameText(group.key)}
        </span>
        <span className="flex items-center gap-1.5">
          {props.kinds.map((k, i) => (
            <span key={`${k}-${String(i)}`} style={{ color: KIND_COLOR[k] }}>
              <KindGlyph kind={k} size={12} />
            </span>
          ))}
        </span>
      </span>
      <span className="font-mono text-mono-sm text-text-tertiary">{group.members.length}</span>
    </button>
  );
}

/** 정거장: 고리 위 구슬과 안쪽 이름. 블록 하나를 묶는 노드라서 누르면 그 블록에 붙은 것만 밝아진다 */
export function StationNode(props: {
  readonly id: StationId;
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly count: number;
  readonly onSelect: (id: string) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLElement>, id: string) => void;
}): ReactNode {
  const deg = STATION_ANGLE[props.id];
  const bead = polar(RING, deg);
  // 이름은 고리 안쪽. 컨텍스트 조립만 바깥(안쪽은 Inject가 그 정거장으로 모인다)
  const label = props.id === "context" ? polar(RING + 44, deg) : polar(RING - 30, deg);
  const name = t(STATION_TEXT[props.id]);
  return (
    <>
      <button
        type="button"
        data-cve-station={props.id}
        aria-label={t("desktop.craft.canvas.cvE.stationAria", { name, count: props.count })}
        aria-pressed={props.selected}
        onClick={() => {
          props.onSelect(`station:${props.id}`);
        }}
        onKeyDown={(e) => {
          props.onKeyDown(e, `station:${props.id}`);
        }}
        style={{ left: bead.x - 12, top: bead.y - 12 }}
        className={cn(
          "group absolute flex size-6 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:focus-ring",
          props.dimmed && "opacity-40",
        )}
      >
        {/* 구슬: 바탕색으로 고리를 끊고, 겹고리 안에 점 하나 */}
        <span
          aria-hidden
          className={cn(
            "flex size-4 items-center justify-center rounded-full border-[1.5px] bg-bg-canvas transition-[border-color,transform] duration-quick",
            props.selected
              ? "scale-125 border-[var(--cs-color-canvas-selection)]"
              : "border-text-secondary group-hover:border-text-primary",
          )}
        >
          <span className="size-1.5 rounded-full bg-text-primary" />
        </span>
      </button>
      <span
        aria-hidden
        style={{ left: label.x, top: label.y }}
        className={cn(
          "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-caption transition-colors duration-quick",
          props.selected ? "text-text-primary" : "text-text-tertiary",
          props.dimmed && "opacity-40",
        )}
      >
        {name}
      </span>
    </>
  );
}
