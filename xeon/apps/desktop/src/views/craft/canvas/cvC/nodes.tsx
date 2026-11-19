// cvC 캔버스의 노드: 지점(틀), 플러그인 카드, 접힌 묶음, 놓을 자리.
// 지점은 플러그인과 다른 종류다: 머리말이 달린 반투명 틀이고(경계는 알약), 블록 틀 안에 몸통 우물이 있다.
// Hook은 몸통 밖(앞·뒤)의 레일에, Inject·도구는 몸통 우물 안에 선다. 그래서 "어디에 어떻게 붙나"가 자리로 읽힌다.
// 플러그인 카드: 프로필 것은 떠 있고(그림자), 베이스 것은 가라앉아 있고(우물 바탕, 선), 드래프트는 점선 틀이다.
import { t } from "@fresnel/client/i18n";
import { ChevronDown, Layers, Shield } from "@caustic/react/icons";
import { assertNever } from "@fresnel/contracts";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { decisionLabel, giveLabel, kindLabel, pointLabel } from "./labels.ts";
import { KindWell, Mark } from "./marks.tsx";
import {
  isBoundary,
  POINTS,
  type CardBox,
  type Member,
  type SlotBox,
  type StationBox,
} from "./model.ts";
import { pluginOf, type DriveStep, type PluginKind, type SampleGroup } from "./sample.ts";

/** 움직임 줄이기가 아니면 자리·빛 바뀜에 붙이는 전환 */
function easeClass(reduced: boolean): string {
  return reduced
    ? ""
    : "transition-[translate,opacity,box-shadow,border-color,background-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]";
}

function at(x: number, y: number): { readonly translate: string } {
  return { translate: `${x}px ${y}px` };
}

// ── 지점 ────────────────────────────────────────────────────────────

export function Station(props: {
  readonly box: StationBox;
  readonly dragging: boolean;
  readonly reduced: boolean;
}): ReactNode {
  const { box } = props;
  const boundary = isBoundary(box.point);
  const pill = boundary && box.count === 0 && !box.open;
  const order = String(POINTS.indexOf(box.point)).padStart(2, "0");
  const dim = props.dragging && !box.open;
  return (
    <>
      <div
        role="group"
        aria-label={t("desktop.craft.canvas.cvC.station.label", {
          name: pointLabel(box.point),
          count: box.count,
        })}
        data-cvc-station={box.point}
        className={`absolute top-0 left-0 border ${pill ? "rounded-full" : "rounded-[18px]"} ${
          box.open
            ? "border-accent-border bg-surface-base/80 shadow-[0_0_0_4px_var(--cs-color-accent-tint)]"
            : "border-border-subtle bg-surface-base/70"
        } ${dim ? "opacity-45" : ""} ${easeClass(props.reduced)}`}
        style={{ ...at(box.rect.x, box.rect.y), width: box.rect.w, height: box.rect.h }}
      >
        <div className="flex h-11 items-center gap-2 px-3.5">
          <span className="font-mono text-mono-sm text-text-tertiary tabular-nums">{order}</span>
          {boundary && <span aria-hidden className="h-3 w-px bg-border-strong" />}
          <span className="min-w-0 flex-1 truncate text-ui-strong text-text-primary">
            {pointLabel(box.point)}
          </span>
          {box.count > 0 && (
            <span className="font-mono text-mono-sm text-text-tertiary tabular-nums">
              {box.count}
            </span>
          )}
        </div>
      </div>
      {box.body !== null && box.body.h > 18 && (
        <div
          aria-hidden
          className={`absolute top-0 left-0 rounded-xl border border-border-subtle bg-bg-inset/80 ${
            dim ? "opacity-45" : ""
          } ${easeClass(props.reduced)}`}
          style={{ ...at(box.body.x, box.body.y), width: box.body.w, height: box.body.h }}
        />
      )}
      {/* 몸통이 비면(Hook만 붙은 블록) 블록 자리를 짧은 막대 하나로 둔다: Hook은 그 앞과 뒤에 선다 */}
      {box.body !== null && box.body.h <= 18 && (
        <div
          aria-hidden
          className={`absolute top-0 left-0 h-1 w-10 rounded-full bg-border-default ${dim ? "opacity-45" : ""}`}
          style={at(box.body.x + box.body.w / 2 - 20, box.body.y + 7)}
        />
      )}
    </>
  );
}

// ── 플러그인 카드 ────────────────────────────────────────────────────

export interface CardHandlers {
  readonly onSelect: (key: string) => void;
  readonly onOpen: (name: string) => void;
  readonly onKey: (key: string, e: KeyboardEvent<HTMLElement>) => void;
  readonly onPress: (key: string, e: PointerEvent<HTMLElement>) => void;
  readonly onToggleGroup: (id: string) => void;
}

interface CardState {
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly reduced: boolean;
  /** 펼친 묶음의 구성원이면 그 묶음 */
  readonly tab: SampleGroup | null;
  readonly start: boolean;
  /** 끄는 중인 원래 카드(자리에 흐린 자국만 남는다) */
  readonly lifted: boolean;
}

function surfaceClass(m: Member, selected: boolean): string {
  const ring = selected
    ? "ring-2 ring-accent-border-strong shadow-[0_0_0_6px_var(--cs-color-accent-tint),0_10px_28px_-10px_var(--cs-color-accent-glow)]"
    : "";
  switch (m.source) {
    case "base":
      return `border border-border-subtle bg-bg-inset ${ring}`;
    case "draft":
      return `border border-dashed border-border-strong bg-surface-base/60 ${ring}`;
    case "profile":
      return `bg-surface-raised ${selected ? ring : "shadow-1 hover:shadow-2"}`;
    default:
      return assertNever(m.source, "surfaceClass");
  }
}

/** Drive의 자기 루프를 점으로: 단계마다 점 하나, 나란한 단계는 세로 점 여럿, 끝에서 처음으로 돌아가는 호 */
export function StepStrip(props: { readonly steps: readonly DriveStep[] }): ReactNode {
  const gap = 18;
  const w = (props.steps.length - 1) * gap + 12;
  return (
    <svg aria-hidden width={w} height={16} viewBox={`0 0 ${w} 16`} className="text-text-tertiary">
      <path d={`M6 11 H${w - 6}`} stroke="currentColor" strokeWidth={1} fill="none" opacity={0.6} />
      {props.steps.map((s, i) => {
        const cx = 6 + i * gap;
        const n = s.parallel?.length ?? 1;
        return Array.from({ length: n }, (_, j) => (
          <circle
            key={`${s.id}-${String(j)}`}
            cx={cx}
            cy={11 - (j - (n - 1) / 2) * 4.2}
            r={2}
            fill="currentColor"
          />
        ));
      })}
      <path
        d={`M${w - 6} 8 Q${w / 2} -2 6 8`}
        stroke="currentColor"
        strokeWidth={1}
        fill="none"
        strokeDasharray="2 2"
        opacity={0.7}
      />
    </svg>
  );
}

function subLine(m: Member): ReactNode {
  const plugin = pluginOf(m.name);
  if (plugin === undefined) return null;
  switch (plugin.kind) {
    case "hook":
      return (
        <span className="flex items-center gap-1">
          {plugin.guard === true && <Shield size={12} aria-hidden />}
          {plugin.decision === undefined ? null : decisionLabel(plugin.decision)}
        </span>
      );
    case "drive":
      return <StepStrip steps={plugin.inside.steps ?? []} />;
    case "inject":
    case "tool":
      return (plugin.gives ?? []).map(giveLabel).join(" · ");
    default:
      return assertNever(plugin.kind, "subLine");
  }
}

export function PluginCard(props: {
  readonly box: CardBox;
  readonly member: Member;
  readonly state: CardState;
  readonly on: CardHandlers;
}): ReactNode {
  const { box, member: m, state } = props;
  const drive = box.place.lane === "drive";
  const hook = m.kind === "hook";
  const name = m.name;
  const label = [
    name,
    kindLabel(m.kind),
    m.source === "base" ? t("desktop.craft.canvas.cvC.source.base") : null,
    m.source === "draft" ? t("desktop.craft.canvas.cvC.source.draft") : null,
    state.start ? t("desktop.craft.canvas.cvC.startDrive") : null,
  ]
    .filter((s) => s !== null)
    .join(", ");
  return (
    <>
      <button
        type="button"
        data-slot="cvc-button"
        data-cvc-card={name}
        aria-label={label}
        aria-pressed={state.selected}
        onClick={() => props.on.onSelect(name)}
        onDoubleClick={() => props.on.onOpen(name)}
        onKeyDown={(e) => props.on.onKey(name, e)}
        onPointerDown={(e) => props.on.onPress(name, e)}
        className={`group/card absolute top-0 left-0 flex items-center gap-2.5 pr-3 pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
          drive ? "rounded-2xl" : "rounded-xl"
        } ${surfaceClass(m, state.selected)} ${state.dimmed ? "opacity-45" : ""} ${
          state.lifted ? "opacity-30" : ""
        } ${easeClass(state.reduced)}`}
        style={{ ...at(box.rect.x, box.rect.y), width: box.rect.w, height: box.rect.h }}
      >
        {hook && (
          <span
            aria-hidden
            className="absolute top-1/2 left-0 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-text-tertiary"
          />
        )}
        <KindWell kind={m.kind} muted={m.source !== "profile"} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={`truncate text-ui-strong ${
              m.source === "profile" ? "text-text-primary" : "text-text-secondary"
            }`}
          >
            {name}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 truncate text-ui-xs text-text-tertiary">
            {subLine(m)}
            {m.source === "draft" && (
              <span className="rounded border border-dashed border-border-strong px-1 text-text-secondary">
                {t("desktop.craft.canvas.cvC.source.draft")}
              </span>
            )}
          </span>
        </span>
        {m.source === "base" && (
          <span title={t("desktop.craft.canvas.cvC.source.base")} className="text-text-tertiary">
            <Layers size={14} aria-hidden />
          </span>
        )}
        {state.start && (
          <span className="rounded-md bg-fill-hover px-1.5 text-ui-xs text-text-secondary">
            {t("desktop.craft.canvas.cvC.start")}
          </span>
        )}
      </button>
      {state.tab !== null && (
        <button
          type="button"
          data-slot="cvc-button"
          aria-label={t("desktop.craft.canvas.cvC.group.collapse", { name: state.tab.name })}
          onClick={() => props.on.onToggleGroup(state.tab?.id ?? "")}
          className={`absolute top-0 left-0 z-10 flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full border border-border-default bg-bg-canvas px-1.5 text-ui-xs text-text-secondary hover:text-text-primary ${
            state.dimmed ? "opacity-45" : ""
          } ${easeClass(state.reduced)}`}
          style={at(box.rect.x + box.rect.w - 58, box.rect.y - 9)}
        >
          <Mark name="group" size={11} />
          {state.tab.name}
        </button>
      )}
    </>
  );
}

// ── 접힌 묶음 ───────────────────────────────────────────────────────

export function GroupCard(props: {
  readonly box: CardBox;
  readonly group: SampleGroup;
  readonly kinds: readonly PluginKind[];
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly reduced: boolean;
  readonly on: CardHandlers;
}): ReactNode {
  const { box, group } = props;
  const key = `group:${group.id}`;
  const kinds = props.kinds;
  const fade = props.dimmed ? "opacity-45" : "";
  return (
    <>
      <div
        aria-hidden
        className={`absolute top-0 left-0 rounded-xl border border-border-default bg-surface-raised ${fade} ${easeClass(props.reduced)}`}
        style={{ ...at(box.rect.x + 6, box.rect.y + 6), width: box.rect.w, height: box.rect.h }}
      />
      <button
        type="button"
        data-slot="cvc-button"
        data-cvc-card={key}
        aria-label={t("desktop.craft.canvas.cvC.group.label", {
          name: group.name,
          count: group.members.length,
        })}
        aria-pressed={props.selected}
        onClick={() => props.on.onSelect(key)}
        onDoubleClick={() => props.on.onToggleGroup(group.id)}
        onKeyDown={(e) => props.on.onKey(key, e)}
        className={`absolute top-0 left-0 flex items-center gap-2.5 rounded-xl pr-2 pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
          props.selected
            ? "bg-surface-raised ring-2 ring-accent-border-strong shadow-[0_0_0_6px_var(--cs-color-accent-tint)]"
            : "bg-surface-raised shadow-2"
        } ${fade} ${easeClass(props.reduced)}`}
        style={{ ...at(box.rect.x, box.rect.y), width: box.rect.w, height: box.rect.h }}
      >
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-inset text-text-secondary"
        >
          <Mark name="group" size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-ui-strong text-text-primary">{group.name}</span>
          <span className="flex items-center gap-1 text-text-tertiary">
            {kinds.map((k, i) => (
              <Mark key={`${k}-${String(i)}`} name={k} size={12} />
            ))}
            <span className="ml-0.5 font-mono text-mono-sm tabular-nums">
              {group.members.length}
            </span>
          </span>
        </span>
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary"
        >
          <ChevronDown size={14} />
        </span>
      </button>
    </>
  );
}

// ── 놓을 자리 ────────────────────────────────────────────────────────

export function Slot(props: {
  readonly box: SlotBox;
  readonly label: string;
  readonly keyboard: boolean;
  readonly reduced: boolean;
  readonly onPlace: (box: SlotBox) => void;
  readonly onFocusSlot: (box: SlotBox) => void;
}): ReactNode {
  const { box } = props;
  const vertical = box.rect.h > box.rect.w;
  const id = `${box.place.lane === "drive" ? "drive" : `${box.place.point}/${box.place.side}`}#${String(box.index)}`;
  return (
    <button
      type="button"
      data-slot="cvc-button"
      tabIndex={props.keyboard ? 0 : -1}
      data-cvc-slot={id}
      aria-label={props.label}
      onClick={() => props.onPlace(box)}
      onFocus={() => props.onFocusSlot(box)}
      className={`absolute top-0 left-0 rounded-xl outline-none ${
        box.hot
          ? "border border-dashed border-accent-border-strong bg-accent-tint shadow-[0_0_24px_-4px_var(--cs-color-accent-glow)]"
          : "border border-transparent"
      } ${easeClass(props.reduced)}`}
      style={{ ...at(box.rect.x, box.rect.y), width: box.rect.w, height: box.rect.h }}
    >
      {!box.hot && (
        <span
          aria-hidden
          className={`absolute rounded-full bg-accent-border ${
            vertical
              ? "top-2 bottom-2 left-1/2 w-0.5 -translate-x-1/2"
              : "top-1/2 right-2 left-2 h-0.5 -translate-y-1/2"
          }`}
        />
      )}
    </button>
  );
}
