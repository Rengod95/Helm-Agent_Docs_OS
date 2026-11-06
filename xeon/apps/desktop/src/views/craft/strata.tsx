// 순서(Strata): 에이전트 루프가 실제로 도는 순서를 위에서 아래로 이은 하나의 흐름으로 그린다.
// 줄 하나가 한 순간이고 줄 안의 핸들러는 불리는 순서다. 코어의 내장 단계(압축, 컨텍스트 조립, 모델 호출, 도구 실행)도 같은 흐름의 줄이다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  CORE_STEPS,
  HOOKS,
  OTHER_HOOKS,
  PHASES,
  hooksInOrder,
  isOn,
  moveHandler,
  resetOrder,
  toggleTargets,
  type CanvasPlugin,
  type CanvasSnapshot,
  type Contrib,
  type HookOrderState,
  type KindFilter,
  type OrderWarning,
  type Sel,
} from "@fresnel/client/workbench/canvas";
import type { HooksOrderSetResult } from "@fresnel/contracts/wire";
import { attemptAsync, assertNever, detach, rethrow } from "@fresnel/contracts";
import { Badge, Button, Card, SectionHeader } from "@caustic/react";
import { GripVertical, Lock, Plus, TriangleAlert } from "@caustic/react/icons";
import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { DropBar, useRowDrag, type RowDrag } from "./drag.tsx";
import { InfoTip } from "./info-tip.tsx";
import { OrderWarningModal } from "./order-modal.tsx";
import { useCraft } from "./craft-context.tsx";
import { PANEL_W } from "./selection-panel.tsx";
import {
  keyReorder,
  readOrderView,
  requestReorder,
  saveConfirmed,
  type ReorderConfirm,
} from "./strata-flow.ts";
import {
  litFor,
  matchesFilter,
  mergeVisibleLane,
  overridesOf,
  reorderable,
  rowWarningOf,
  visibleLane,
  type LaneMap,
  type Lit,
  type RowWarning,
} from "./strata-model.ts";

type PhaseId = (typeof PHASES)[number];
type Fold = (typeof HOOKS)[number]["fold"];
type CoreDef = (typeof CORE_STEPS)[number];
type FailureKey =
  | "desktop.craft.strata.error.load"
  | "desktop.craft.strata.error.save"
  | "desktop.craft.strata.error.reset"
  | "desktop.craft.strata.error.toggle";

/** 줄 하나를 그리는 데 필요한 훅 정보. 13개(HOOKS)와 33개(OTHER_HOOKS)가 같은 모양으로 쓴다 */
export interface RowDef {
  readonly id: string;
  readonly fold: Fold;
  /** 내장이 이 순간을 맡고 있다(압축) */
  readonly builtin: boolean;
}

const ROW =
  "relative grid grid-cols-[24px_minmax(0,11rem)_minmax(0,1fr)] gap-x-3 rounded-2xl px-2 py-2.5";

/** 화면에 늘 보이는 13개 순간의 이름. 키는 메시지 카탈로그의 id다 */
const HOOK_LABEL: Readonly<Record<string, MessageId>> = {
  "thread.start": "desktop.craft.strata.hook.thread.start",
  "input.user.before": "desktop.craft.strata.hook.input.user.before",
  "input.agent.before": "desktop.craft.strata.hook.input.agent.before",
  "thread.compact.before": "desktop.craft.strata.hook.thread.compact.before",
  "request.provider.before": "desktop.craft.strata.hook.request.provider.before",
  "guard.model.before": "desktop.craft.strata.hook.guard.model.before",
  "request.model.after": "desktop.craft.strata.hook.request.model.after",
  "tool.call.before": "desktop.craft.strata.hook.tool.call.before",
  "tool.result": "desktop.craft.strata.hook.tool.result",
  "tool.execution.after": "desktop.craft.strata.hook.tool.execution.after",
  "boundary.step.after": "desktop.craft.strata.hook.boundary.step.after",
  "boundary.settle.after": "desktop.craft.strata.hook.boundary.settle.after",
  "thread.shutdown": "desktop.craft.strata.hook.thread.shutdown",
};

const PHASE_LABEL: Readonly<Record<PhaseId, MessageId>> = {
  start: "desktop.craft.strata.phase.start",
  think: "desktop.craft.strata.phase.think",
  act: "desktop.craft.strata.phase.act",
  wrap: "desktop.craft.strata.phase.wrap",
};

const FOLD_LABEL: Readonly<Record<Fold, MessageId>> = {
  tap: "desktop.craft.strata.fold.tap",
  first: "desktop.craft.strata.fold.first",
  chain: "desktop.craft.strata.fold.chain",
  collect: "desktop.craft.strata.fold.collect",
};

const FOLD_TIP: Readonly<Record<Fold, MessageId>> = {
  tap: "desktop.craft.strata.foldTip.tap",
  first: "desktop.craft.strata.foldTip.first",
  chain: "desktop.craft.strata.foldTip.chain",
  collect: "desktop.craft.strata.foldTip.collect",
};

const CORE_LABEL: Readonly<Record<string, MessageId>> = {
  "core.context.assemble": "desktop.craft.strata.core.context.assemble",
  "core.model.call": "desktop.craft.strata.core.model.call",
  "core.tools.run": "desktop.craft.strata.core.tools.run",
};

/** 화면의 모든 줄이 함께 쓰는 값과 동작. 줄 컴포넌트마다 props를 늘어놓지 않으려고 하나로 묶었다 */
export interface StrataCtx {
  readonly snapshot: CanvasSnapshot;
  readonly lanes: LaneMap;
  readonly lit: Lit;
  readonly sel: Sel;
  readonly kind: KindFilter;
  readonly contrib: readonly Contrib[];
  /** 저장만 되고 아직 적용 전인 훅 */
  readonly pending: ReadonlySet<string>;
  /** 저장된 덮어쓰기가 있는 훅(기본 순서로 되돌리기를 보인다) */
  readonly saved: ReadonlySet<string>;
  /** 적용 중인 저장 순서가 건너뛰는 것을 훅별로 미리 본 경고(`warningsOf`). 없는 훅은 줄 경고가 없다 */
  readonly warnings: Readonly<Record<string, OrderWarning>>;
  readonly select: (sel: Sel) => void;
  readonly pickPlugin: (id: string) => void;
  readonly toggle: (p: CanvasPlugin) => void;
  readonly reorder: (hook: string, before: readonly string[], after: readonly string[]) => void;
  readonly reset: (hook: string) => void;
  readonly add: (hook: string) => void;
}

export function Strata(): ReactNode {
  const { source, state, dispatch } = useCraft();
  const { snapshot, orderPort: port } = source;
  const plugins = snapshot.plugins;
  // 훅별 저장·보류 상태(readOrderView가 읽는다). 적용 중인 순서는 source.order가 준다
  const [orders, setOrders] = useState<Readonly<Record<string, HookOrderState>>>({});
  const [warnings, setWarnings] = useState<Readonly<Record<string, OrderWarning>>>({});
  const [confirm, setConfirm] = useState<ReorderConfirm | null>(null);
  const [failure, setFailure] = useState<FailureKey | null>(null);
  const [applies, setApplies] = useState<HooksOrderSetResult["appliesAt"] | null>(null);

  const nameOf = useCallback(
    (id: string): string => plugins.find((p) => p.id === id)?.name ?? id,
    [plugins],
  );
  // 보류 중인 저장 순서는 적용 전에도 줄에 보인다. 사용자가 끌어 놓은 자리를 바로 보기 위해서다
  const lanes = hooksInOrder(plugins, overridesOf(source.order, orders));
  const lit = litFor(state.sel, snapshot, lanes);
  const pending = new Set(
    Object.entries(orders)
      .filter(([, s]) => s.pending)
      .map(([h]) => h),
  );
  const saved = new Set(
    Object.entries(orders)
      .filter(([, s]) => s.saved.length > 0)
      .map(([h]) => h),
  );

  // 저장과 줄 경고를 읽어 화면에 넣는다. 실패는 줄 위에 알린다
  const loadOrders = useCallback(async (): Promise<void> => {
    const r = await readOrderView(port, nameOf);
    if (!r.ok) {
      setFailure("desktop.craft.strata.error.load");
      return;
    }
    setOrders(r.value.orders);
    setWarnings(r.value.warnings);
  }, [port, nameOf]);

  // 처음 열릴 때 한 번 읽고, 플러그인 목록이 바뀌면 다시 읽는다. 화면을 떠난 뒤 온 결과는 버린다
  useEffect(() => {
    let live = true;
    const first = async (): Promise<void> => {
      const r = await readOrderView(port, nameOf);
      if (!live) return;
      if (!r.ok) {
        setFailure("desktop.craft.strata.error.load");
        return;
      }
      setOrders(r.value.orders);
      setWarnings(r.value.warnings);
    };
    detach(first(), rethrow);
    return () => {
      live = false;
    };
  }, [port, nameOf]);

  const applyReorder = async (
    hook: string,
    before: readonly string[],
    after: readonly string[],
  ): Promise<void> => {
    const r = await requestReorder(port, hook, before, after, nameOf);
    if (!r.ok) {
      setFailure("desktop.craft.strata.error.save");
      return;
    }
    const step = r.value;
    switch (step.k) {
      case "unchanged":
        return;
      case "saved":
        setFailure(null);
        setApplies(step.committed.appliesAt);
        await loadOrders();
        return;
      case "confirm":
        setConfirm(step);
        return;
      default:
        return assertNever(step, "Strata.applyReorder");
    }
  };

  const saveConfirm = async (c: ReorderConfirm): Promise<void> => {
    setConfirm(null);
    const r = await saveConfirmed(port, c);
    if (!r.ok) {
      setFailure("desktop.craft.strata.error.save");
      return;
    }
    setFailure(null);
    setApplies(r.value.appliesAt);
    await loadOrders();
  };

  const resetHook = async (hook: string): Promise<void> => {
    const r = await resetOrder(port, hook);
    if (!r.ok) {
      setFailure("desktop.craft.strata.error.reset");
      return;
    }
    setFailure(null);
    setApplies(r.value.appliesAt);
    await loadOrders();
  };

  const toggleOne = async (p: CanvasPlugin): Promise<void> => {
    // 그룹에 속하면 그룹 전체가 바뀐다(결정 15-1). 대상은 toggleTargets가 정한다
    const r = await attemptAsync(() => source.setOn(toggleTargets(snapshot, p.id), !isOn(p)));
    if (!r.ok) setFailure("desktop.craft.strata.error.toggle");
  };

  const ctx: StrataCtx = {
    snapshot,
    lanes,
    lit,
    sel: state.sel,
    kind: state.kind,
    contrib: state.contrib,
    pending,
    saved,
    warnings,
    select: (sel) => dispatch({ t: "selectOther", sel }),
    pickPlugin: (id) => dispatch({ t: "selectPlugin", id }),
    toggle: (p) => detach(toggleOne(p), rethrow),
    reorder: (hook, before, after) => detach(applyReorder(hook, before, after), rethrow),
    reset: (hook) => detach(resetHook(hook), rethrow),
    add: (hook) => source.openBuilder(hook),
  };

  // 선택 패널이 오른쪽에 뜨면 줄이 그 밑으로 가지 않게 오른쪽 여백을 비운다(시안 Lanes rightInset)
  const panelOpen = state.panel && state.sel.k !== "layer";
  return (
    <section
      aria-label={t("desktop.craft.strata.title")}
      className="h-full overflow-y-auto"
      style={panelOpen ? { paddingRight: PANEL_W + 24 } : undefined}
    >
      <div className="mx-auto grid max-w-[960px] gap-3 px-4 pb-10 pt-4">
        <Card variant="surface" size="sm" shadow="3" className="gap-0 p-2">
          <SectionHeader
            size="sm"
            title={t("desktop.craft.strata.title")}
            className="h-12 items-center px-2"
          />
          {failure !== null && (
            <div
              role="alert"
              className="mx-2 mb-2 flex items-center justify-between gap-3 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-ui-sm text-danger-text"
            >
              <span>{t(failure)}</span>
              <Button size="xs" variant="ghost" onClick={() => setFailure(null)}>
                {t("desktop.craft.strata.dismiss")}
              </Button>
            </div>
          )}
          {applies !== null && (
            <p role="status" className="mx-2 mb-2 text-footnote text-text-secondary">
              {t("desktop.craft.strata.appliesAt")}
            </p>
          )}
          <div className="relative">
            <span
              aria-hidden
              className="absolute bottom-6 left-[20px] top-4 w-px bg-border-strong"
            />
            {PHASES.map((phase) => (
              <div key={phase}>
                <PhaseLabel label={t(PHASE_LABEL[phase])} />
                {HOOKS.filter((h) => h.phase === phase).flatMap((h) => {
                  const def: RowDef = { id: h.id, fold: h.fold, builtin: h.builtin !== undefined };
                  const core = CORE_STEPS.find((c) => c.after === h.id);
                  const row = <HookRow key={h.id} def={def} mono={false} ctx={ctx} />;
                  return core === undefined ? [row] : [row, <CoreRow key={core.id} step={core} />];
                })}
              </div>
            ))}
            <details className="mt-3 px-2 py-2">
              <summary className="ms-9 cursor-pointer text-ui-sm text-text-secondary">
                {t("desktop.craft.strata.others", { count: OTHER_HOOKS.length })}
              </summary>
              <div className="mt-2">
                {OTHER_HOOKS.map((o) => (
                  <HookRow
                    key={o.id}
                    def={{ id: o.id, fold: o.fold, builtin: false }}
                    mono
                    ctx={ctx}
                  />
                ))}
              </div>
            </details>
          </div>
        </Card>
        <OrderWarningModal
          confirm={confirm}
          onSave={() => {
            if (confirm !== null) detach(saveConfirm(confirm), rethrow);
          }}
          onCancel={() => setConfirm(null)}
        />
      </div>
    </section>
  );
}

function PhaseLabel({ label }: { readonly label: string }): ReactNode {
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 px-2 pb-0.5 pt-3">
      <span aria-hidden />
      <span className="text-footnote font-medium text-text-tertiary">{label}</span>
    </div>
  );
}

/** 줄기 위의 마디: 코어 단계는 채운 네모, 훅 줄은 속 빈 동그라미 */
function Node({ core }: { readonly core: boolean }): ReactNode {
  return (
    <span
      aria-hidden
      className="relative z-10 mt-2.5 grid size-6 place-items-center justify-self-center"
    >
      {core ? (
        <span className="size-3.5 rounded-[5px] bg-text-primary shadow-1" />
      ) : (
        <span className="size-2.5 rounded-full border-2 border-text-tertiary bg-surface-raised" />
      )}
    </span>
  );
}

/** 항목 사이의 작은 화살표: 불리는 순서를 가리킨다 */
function Next(): ReactNode {
  return (
    <span aria-hidden className="flex-none select-none text-footnote text-text-tertiary opacity-60">
      ›
    </span>
  );
}

/** 줄 이름 옆의 규칙 이름표(관찰·차단·수정·합치기). 이름은 보이고, 한 줄 설명은 옆의 정보 아이콘 뒤에 있다 */
function FoldTag({ fold }: { readonly fold: Fold }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="cursor-default rounded-md border border-border-subtle px-1.5 py-px text-footnote text-text-secondary">
        {t(FOLD_LABEL[fold])}
      </span>
      <InfoTip text={t(FOLD_TIP[fold])} />
    </span>
  );
}

/** 훅 줄 하나: 이름과 규칙, 그 안의 핸들러들, 끝의 추가(와 그 옆의 경고 한 줄) */
export function HookRow({
  def,
  mono,
  ctx,
}: {
  readonly def: RowDef;
  readonly mono: boolean;
  readonly ctx: StrataCtx;
}): ReactNode {
  const lane = ctx.lanes[def.id] ?? [];
  const shownCount = visibleLane(lane, ctx.snapshot, ctx.contrib).length;
  // 끌기 손잡이는 순서가 값을 바꾸는 훅에서만, 핸들러가 둘 이상일 때만 준다. 나머지 줄은 순서를 읽기만 한다
  const movable = reorderable(def.id, shownCount);
  // 끌어 놓기의 자리는 보이는 핸들러 사이의 자리다. 가려진 핸들러는 제자리에 남긴다
  const drag = useRowDrag((id, index) => {
    const next = moveHandler(visibleLane(lane, ctx.snapshot, ctx.contrib), id, index);
    ctx.reorder(def.id, lane, mergeVisibleLane(lane, ctx.snapshot, ctx.contrib, next));
  });
  const picked = ctx.sel.k === "hook" && ctx.sel.id === def.id;
  const lit = ctx.lit.hooks.has(def.id);
  const label = HOOK_LABEL[def.id];
  const isPending = ctx.pending.has(def.id);
  const isSaved = ctx.saved.has(def.id);
  const warning = ctx.warnings[def.id];
  // 경고는 저장된 순서가 적용 중이고 핸들러가 둘 이상일 때만. 기본 순서는 경고하지 않는다
  const line: RowWarning | null =
    warning === undefined || !isSaved || shownCount < 2 ? null : rowWarningOf(warning);
  return (
    <div data-hook={def.id} className={`${ROW} ${lit ? "bg-neutral-soft" : ""}`}>
      <Node core={false} />
      <div className="grid min-w-0 content-start gap-0.5 pt-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <button
            type="button"
            aria-pressed={picked}
            onClick={() => ctx.select({ k: "hook", id: def.id })}
            className={`min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-start outline-none focus-visible:underline ${mono ? "font-mono text-mono-sm text-text-primary" : "text-ui-strong text-text-primary"}`}
          >
            {mono ? def.id : label === undefined ? def.id : t(label)}
          </button>
          <FoldTag fold={def.fold} />
          {isPending && <Badge size="xs">{t("desktop.craft.strata.pending")}</Badge>}
        </div>
        {!mono && (
          <span className="truncate font-mono text-mono-sm text-text-tertiary">{def.id}</span>
        )}
        {isSaved && (
          <div>
            <Button size="xs" variant="ghost" onClick={() => ctx.reset(def.id)}>
              {t("desktop.craft.strata.reset")}
            </Button>
          </div>
        )}
      </div>
      <div
        data-lane={def.id}
        className="flex min-h-8 min-w-0 flex-wrap content-start items-center gap-x-1.5 gap-y-2 rounded-lg"
      >
        {def.builtin && <CompactChip hook={def.id} ctx={ctx} />}
        <LaneItems
          hook={def.id}
          lane={lane}
          drag={drag}
          ctx={ctx}
          withBuiltin={def.builtin}
          movable={movable}
        />
        <Button
          variant="ghost"
          size="sm"
          iconStart={<Plus />}
          className="border border-dashed border-border-strong"
          onClick={() => ctx.add(def.id)}
        >
          {t("desktop.craft.strata.add")}
        </Button>
        {line !== null && <RowWarningLine line={line} />}
      </div>
    </div>
  );
}

/** 추가 옆의 경고 한 줄: 저장된 순서가 건너뛰는 것을 이름으로 알린다. 자세한 것은 저장 전 확인 창이 보인다 */
function RowWarningLine({ line }: { readonly line: RowWarning }): ReactNode {
  return (
    <span
      role="status"
      className="inline-flex min-w-0 items-center gap-1.5 text-ui-xs text-warning-text"
    >
      <TriangleAlert aria-hidden className="size-3.5 flex-none" />
      {rowWarningText(line)}
    </span>
  );
}

function rowWarningText(line: RowWarning): string {
  const first = firstWarningText(line);
  return line.more > 0
    ? t("desktop.craft.strata.rowWarning.more", { line: first, count: line.more })
    : first;
}

function firstWarningText(line: RowWarning): string {
  switch (line.k) {
    case "skip":
      return line.by === null
        ? t("desktop.craft.strata.rowWarning.skipNoBy", { name: line.name })
        : t("desktop.craft.strata.rowWarning.skip", { by: line.by, name: line.name });
    case "guardSkip":
      return t("desktop.craft.strata.rowWarning.guardSkip", { name: line.name });
    case "guardFirst":
      return t("desktop.craft.strata.rowWarning.guardFirst", { name: line.name });
    default:
      return assertNever(line, "firstWarningText");
  }
}

/** 줄 안의 핸들러들. 끌고 있는 칩은 흐리게 두고, 놓일 자리에 세로 막대를 둔다. `movable`이 아니면 읽기만 한다 */
function LaneItems({
  hook,
  lane,
  drag,
  ctx,
  withBuiltin,
  movable,
}: {
  readonly hook: string;
  readonly lane: readonly string[];
  readonly drag: RowDrag;
  readonly ctx: StrataCtx;
  readonly withBuiltin: boolean;
  readonly movable: boolean;
}): ReactNode {
  const items: ReactNode[] = [];
  let shown = withBuiltin ? 1 : 0;
  let rest = 0;
  // 구성 요소 거르기에 맞지 않는 핸들러는 줄에 그리지 않는다
  for (const id of visibleLane(lane, ctx.snapshot, ctx.contrib)) {
    const p = ctx.snapshot.plugins.find((q) => q.id === id);
    if (p === undefined) continue;
    const dragging = drag.dragId === id;
    if (!dragging) {
      if (drag.overIndex === rest) items.push(<DropBar key={`bar-${rest}`} />);
      else if (shown > 0) items.push(<Next key={`n-${id}`} />);
      rest += 1;
    } else if (shown > 0) {
      items.push(<Next key={`n-${id}`} />);
    }
    shown += 1;
    items.push(
      <Pill
        key={id}
        p={p}
        hook={hook}
        lane={lane}
        dragging={dragging}
        movable={movable}
        ctx={ctx}
        onBegin={(e) => drag.begin(id, e)}
      />,
    );
  }
  if (drag.overIndex !== null && drag.overIndex === rest) items.push(<DropBar key="bar-end" />);
  return <>{items}</>;
}

/**
 * 핸들러 하나: 앞의 점은 상태(켜짐 채움, 꺼짐 속 빔, 실패 붉음), 이름은 고르기.
 * `movable`이면 올릴 때 끌기 손잡이가 나오고 끌기와 Alt+←·→가 된다. 아니면 칩은 순서를 읽기만 한다.
 */
function Pill({
  p,
  hook,
  lane,
  dragging,
  movable,
  ctx,
  onBegin,
}: {
  readonly p: CanvasPlugin;
  readonly hook: string;
  readonly lane: readonly string[];
  readonly dragging: boolean;
  readonly movable: boolean;
  readonly ctx: StrataCtx;
  readonly onBegin: (e: ReactPointerEvent<HTMLElement>) => void;
}): ReactNode {
  const on = isOn(p);
  // 실패는 그 핸들러가 실패한 훅 줄에서만 붉게 보인다
  const health = p.health !== undefined && p.health.hook === hook ? p.health : undefined;
  const picked = ctx.sel.k === "plugin" && ctx.sel.id === p.id;
  const lit = ctx.lit.plugins.has(p.id);
  const group = p.group !== undefined;
  const edge = picked
    ? "border-text-primary"
    : health !== undefined
      ? "border-danger-border"
      : group
        ? "border-info-border"
        : "border-border-strong";
  const onKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const next = keyReorder(e, visibleLane(lane, ctx.snapshot, ctx.contrib), p.id);
    if (next === null) return;
    e.preventDefault();
    ctx.reorder(hook, lane, mergeVisibleLane(lane, ctx.snapshot, ctx.contrib, next));
  };
  const dim = !matchesFilter(p, ctx.kind, ctx.contrib);
  return (
    <div
      data-chip={p.id}
      onPointerDown={movable ? onBegin : undefined}
      style={movable ? { touchAction: "none", cursor: "grab" } : undefined}
      className={`group/pill relative inline-flex h-8 max-w-full select-none items-center gap-2 rounded-full border bg-surface-raised text-ui-sm transition-[border-color,background-color,box-shadow] hover:border-text-secondary ${edge} ps-2.5 pe-4 ${picked || lit ? "bg-neutral-soft" : ""} ${on || picked ? "text-text-primary" : "text-text-tertiary"} ${dragging || dim ? "opacity-35" : ""}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={p.name}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => ctx.toggle(p)}
        className="grid size-4 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:shadow-focus"
      >
        <span
          aria-hidden
          className={`size-2 rounded-full transition-colors ${
            health !== undefined
              ? "bg-danger-graphic"
              : on
                ? "bg-text-primary"
                : "border border-text-tertiary bg-transparent"
          }`}
        />
      </button>
      <button
        type="button"
        aria-pressed={picked}
        aria-keyshortcuts={movable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
        onClick={() => ctx.pickPlugin(p.id)}
        onKeyDown={movable ? onKey : undefined}
        className="min-w-0 cursor-pointer truncate whitespace-nowrap border-0 bg-transparent p-0 text-start text-inherit outline-none focus-visible:underline"
      >
        {p.name}
      </button>
      {health !== undefined && (
        <span className="flex-none whitespace-nowrap text-footnote text-danger-text">
          {health.autoOff === true
            ? t("desktop.craft.strata.status.autoOff")
            : t("desktop.craft.strata.status.fail", { count: health.fails })}
        </span>
      )}
      {movable && (
        <GripVertical
          aria-hidden
          className="pointer-events-none absolute right-0.5 size-3.5 text-text-tertiary opacity-0 transition-opacity group-hover/pill:opacity-100"
        />
      )}
    </div>
  );
}

/** 내장 압축 칩: 훅 줄의 맨 앞에 놓인다. 플러그인이 감싸거나 대체할 수 있는 자리다 */
function CompactChip({ hook, ctx }: { readonly hook: string; readonly ctx: StrataCtx }): ReactNode {
  const picked = ctx.sel.k === "builtin" && ctx.sel.slot === `hook:${hook}`;
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={() => ctx.select({ k: "builtin", slot: `hook:${hook}` })}
      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-ui-sm outline-none focus-visible:shadow-focus ${picked ? "border-text-primary bg-text-primary text-surface-base" : "border-border-default bg-neutral-soft text-text-secondary"}`}
    >
      {t("desktop.craft.strata.core.compact.builtin")}
    </button>
  );
}

/** 코어 단계의 줄: 채운 네모, 이름과 id, 내장 칩(잠금이면 자물쇠) */
function CoreRow({ step }: { readonly step: CoreDef }): ReactNode {
  const label = CORE_LABEL[step.id];
  const tip = step.locked
    ? t("desktop.craft.strata.core.locked.tip")
    : t("desktop.craft.strata.core.wrap.tip");
  return (
    <div data-core={step.id} className={ROW}>
      <Node core />
      <div className="grid min-w-0 content-start gap-0.5 pt-1.5">
        <span className="truncate text-ui-strong text-text-primary">
          {label === undefined ? step.id : t(label)}
        </span>
        <span className="truncate font-mono text-mono-sm text-text-tertiary">{step.id}</span>
      </div>
      <div className="flex min-h-8 items-center gap-1">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-default bg-neutral-soft px-3 text-ui-sm text-text-secondary">
          {step.locked && <Lock aria-hidden className="size-3" />}
          {t("desktop.craft.strata.core.builtin")}
        </span>
        <InfoTip text={tip} />
      </div>
    </div>
  );
}
