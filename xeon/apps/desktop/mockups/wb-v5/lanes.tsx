// 순서: 에이전트 루프가 실제로 도는 순서를 위에서 아래로 이어진 하나의 흐름으로 그린다.
// 줄 하나가 한 순간이고, 줄 안의 항목은 불리는 순서(왼쪽에서 오른쪽)다. 코어의 내장 단계(대화 압축, 컨텍스트 조립, 모델 호출, 도구 실행)도
// 같은 흐름의 줄이다: 플러그인은 앞뒤 줄에서 감싸고, 대체할 수 있는 단계는 내장 항목을 플러그인으로 바꾼다.
// 항목은 이름과 상태만 보인다. 끌기 손잡이는 올릴 때 오른쪽 가장자리에 나오고, 켜기·끄기는 앞의 조용한 작은 점이다.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  Chip,
  IconButton,
  Input,
  Popover,
  SectionHeader,
  Separator,
  Tooltip,
} from "@caustic/react";
import { GripVertical, Lock, Plus, Terminal, X } from "../_shell";
import { T } from "../_shell/terms";
import {
  CAPS,
  CORE_STEPS,
  FOLD_LABEL,
  FOLD_TIP,
  HOOKS,
  LAYER_CODE,
  LEAD,
  OTHER_HOOKS,
  PHASES,
  capSlot,
  hookSlot,
  pluginById,
  providersOf,
  type CoreStep,
  type HookDef,
  type Plugin,
} from "./data";
import { useDragSource } from "./drag";
import { litOf, useMock } from "./store";
import { vtName } from "./viewport";

const ROW =
  "relative grid grid-cols-[24px_minmax(0,11rem)_minmax(0,1fr)] gap-x-3 rounded-2xl px-2 py-2.5";

// ── 항목 ──────────────────────────────────────────────────────────
// 항목 전체가 끌기 대상이다(data-chip). 이름은 고르기, 점(또는 올리면 나오는 전원 단추)은 켜기·끄기다.
function PluginItem({ p, hook, replacer }: { p: Plugin; hook: string | null; replacer?: boolean }) {
  const m = useMock();
  const picked = m.sel.k === "plugin" && m.sel.id === p.id;
  const lit = litOf(m.sel, m.plugins, m.order).plugins.has(p.id);
  const on = m.isOn(p.id);
  const h0 = m.health(p.id);
  const h = h0 !== undefined && (hook === null || h0.hook === hook) ? h0 : undefined;
  const drag = useDragSource({ id: p.id, from: hook, label: p.name });
  const dragging = m.drag?.id === p.id && m.drag.from === hook;
  const lane = hook === null ? [] : (m.order[hook] ?? []);
  const draggable = hook !== null;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (hook === null || !e.altKey) return;
    const i = lane.indexOf(p.id);
    if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      m.move(hook, p.id, i - 1);
    } else if (e.key === "ArrowRight" && i < lane.length - 1) {
      e.preventDefault();
      m.move(hook, p.id, i + 1);
    }
  };
  // 같은 플러그인이 여러 줄에 걸려도 보기 전환에서는 맨 위 줄의 항목 하나만 이름을 갖는다
  const firstHook = HOOKS.find((d) => (m.order[d.id] ?? []).includes(p.id))?.id;
  const isGroup = p.group !== undefined;
  const edge = picked
    ? "border-text-primary"
    : h !== undefined
      ? "border-danger-border"
      : isGroup
        ? "border-info-border"
        : "border-border-strong";
  return (
    <div
      data-chip={p.id}
      onPointerDown={draggable ? drag : undefined}
      style={{
        touchAction: "none",
        cursor: draggable ? "grab" : "default",
        viewTransitionName: firstHook === hook ? vtName(p.id) : undefined,
      }}
      className={`group/item relative inline-flex h-8 max-w-full select-none items-center gap-2 rounded-full border bg-surface-raised text-ui-sm transition-[border-color,background-color,box-shadow] hover:border-text-secondary ${edge} ps-2.5 pe-4 ${picked || lit ? "bg-neutral-soft" : ""} ${on || picked ? "text-text-primary" : "text-text-tertiary"} ${dragging || !m.matches(p) ? "opacity-35" : ""}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={p.name}
        data-no-drag
        onClick={() => m.toggle(p.id)}
        className="grid size-4 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:shadow-focus"
      >
        <span
          aria-hidden
          className={`size-2 rounded-full transition-colors ${
            h !== undefined
              ? "bg-danger-graphic"
              : on
                ? "bg-text-primary"
                : "border border-text-tertiary bg-transparent"
          }`}
        />
      </button>
      <button
        type="button"
        onClick={() => m.select({ k: "plugin", id: p.id })}
        onKeyDown={onKey}
        aria-pressed={picked}
        className="min-w-0 cursor-pointer truncate whitespace-nowrap border-0 bg-transparent p-0 text-start text-inherit outline-none focus-visible:underline"
      >
        {p.name}
      </button>
      {h !== undefined && (
        <button
          type="button"
          onClick={() => m.openDrawer(p.id)}
          className="flex-none cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-footnote text-danger-text outline-none hover:underline"
        >
          {h.autoOff === true ? T.autoDisabled : `실패 ${h.fails}`}
        </button>
      )}
      {replacer === true && <Badge size="xs">대체</Badge>}
      {draggable && (
        <GripVertical
          aria-hidden
          className="pointer-events-none absolute right-0.5 size-3.5 text-text-tertiary opacity-0 transition-opacity group-hover/item:opacity-100"
        />
      )}
    </div>
  );
}

/** 코어의 내장 단계 항목: 채워진 네모 항목이라 플러그인 항목과 한눈에 갈린다. 잠금은 통째로 바꿀 수 없다는 뜻이다. */
function CoreItem({
  struck = false,
  locked,
  picked = false,
  tip,
  onClick,
}: {
  struck?: boolean;
  locked: boolean;
  picked?: boolean;
  tip: string | null;
  onClick?: () => void;
}) {
  const body = (
    <span
      role={onClick === undefined ? undefined : "button"}
      tabIndex={onClick === undefined ? undefined : 0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick !== undefined && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-ui-sm outline-none focus-visible:shadow-focus ${picked ? "border-text-primary bg-text-primary text-surface-base" : "border-border-default bg-neutral-soft text-text-secondary"} ${onClick === undefined ? "" : "cursor-pointer hover:bg-neutral-soft-hover"} ${struck ? "line-through opacity-60" : ""}`}
    >
      {locked && <Lock aria-hidden className="size-3" />}
      내장
    </span>
  );
  return tip === null ? (
    body
  ) : (
    <Tooltip content={tip} side="top" delayDuration={400}>
      {body}
    </Tooltip>
  );
}

// ── 더하기·대체 팝오버 ────────────────────────────────────────────
function Pop({
  anchor,
  label,
  children,
}: {
  anchor: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      anchor={anchor}
      aria-label={label}
      size="md"
      arrow={false}
      align="start"
    >
      {children(() => setOpen(false))}
    </Popover>
  );
}

function AddPop({ hook }: { hook: string }) {
  const m = useMock();
  const [cmd, setCmd] = useState("");
  const lane = m.order[hook] ?? [];
  const rest = m.plugins.filter((p) => !lane.includes(p.id) && p.layer !== "L2");
  return (
    <Pop
      anchor={
        <IconButton
          size="sm"
          variant="ghost"
          label="추가"
          className="border border-dashed border-border-strong"
        >
          <Plus />
        </IconButton>
      }
      label="추가"
    >
      {(close) => (
        <>
          {rest.length > 0 && (
            <>
              <div className="grid max-h-40 gap-0.5 overflow-y-auto">
                {rest.map((p) => (
                  <Button
                    key={p.id}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between"
                    onClick={() => {
                      m.addToLane(hook, p.id);
                      close();
                    }}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="flex-none text-footnote text-text-tertiary">
                      {m.isOn(p.id) ? LAYER_CODE[p.layer] : "꺼짐"}
                    </span>
                  </Button>
                ))}
              </div>
              <Separator variant="soft" />
            </>
          )}
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const text = cmd.trim();
              if (text === "") return;
              m.create({ name: text, hook, template: null, command: text });
              setCmd("");
              close();
            }}
          >
            <Input
              size="xs"
              prefix={<Terminal />}
              aria-label="명령"
              containerClassName="min-w-0 flex-1"
              className="font-mono text-mono-sm"
              value={cmd}
              onValueChange={setCmd}
            />
            <Button
              size="xs"
              fieldHeight
              variant="outline"
              type="submit"
              disabled={cmd.trim() === ""}
            >
              연결
            </Button>
          </form>
          <Separator variant="soft" />
          <Button
            variant="ghost"
            size="sm"
            iconStart={<Plus />}
            className="w-full justify-start"
            onClick={() => {
              m.openBuilder(hook);
              close();
            }}
          >
            새로 만들기
          </Button>
        </>
      )}
    </Pop>
  );
}

function ReplacePop({ slot, candidates }: { slot: string; candidates: Plugin[] }) {
  const m = useMock();
  if (candidates.length === 0) return null;
  return (
    <Pop
      anchor={
        <Chip variant="dashed" size="lg">
          대체
        </Chip>
      }
      label="대체"
    >
      {(close) =>
        candidates.map((p) => (
          <Button
            key={p.id}
            variant="ghost"
            size="sm"
            className="w-full justify-between"
            onClick={() => {
              m.replace(slot, p.id);
              close();
            }}
          >
            <span className="truncate">{p.name}</span>
            <span className="flex-none text-footnote text-text-tertiary">{p.version}</span>
          </Button>
        ))
      }
    </Pop>
  );
}

// ── 줄 ────────────────────────────────────────────────────────────
function Marker() {
  return <span aria-hidden className="h-8 w-0.5 flex-none rounded-full bg-text-primary" />;
}
/** 항목 사이: 불리는 순서를 가리키는 작은 화살표 */
function Next() {
  return (
    <span aria-hidden className="flex-none select-none text-footnote text-text-tertiary opacity-60">
      ›
    </span>
  );
}
/** 흐름 줄기 위의 마디: 코어 단계는 채운 네모, 훅 줄은 속 빈 동그라미 */
function Node({ core }: { core: boolean }) {
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
/** 줄 이름 옆의 조용한 이름표(관찰·수정·차단·합치기): 올리면 한 줄 설명 */
function FoldTag({ fold }: { fold: HookDef["fold"] }) {
  return (
    <Tooltip content={FOLD_TIP[fold]} side="top" delayDuration={300}>
      <span className="cursor-default text-footnote text-text-tertiary underline decoration-dotted decoration-border-strong underline-offset-4">
        {FOLD_LABEL[fold]}
      </span>
    </Tooltip>
  );
}

function Lane({ def, mono }: { def: HookDef; mono?: boolean }) {
  const m = useMock();
  const lit = litOf(m.sel, m.plugins, m.order).hooks.has(def.id);
  const picked = m.sel.k === "hook" && m.sel.id === def.id;
  const ids = m.order[def.id] ?? [];
  const slot = hookSlot(def.id);
  const by = m.replaced[slot];
  const over = m.drag?.over?.hook === def.id ? m.drag.over.index : null;
  const draggedId = m.drag?.over?.hook === def.id || m.drag?.from === def.id ? m.drag.id : null;
  const shown = ids.filter((id) => id !== by);
  const candidates = m.plugins.filter((p) => p.hooks.includes(def.id) && p.id !== by);
  const players = shown.map((id, i) => ({
    p: pluginById(id) ?? m.plugins.find((q) => q.id === id),
    i,
  }));
  const empty = def.builtin === undefined && ids.length === 0;
  const isCore = def.builtin !== undefined;
  let n = -1;
  const body: ReactNode[] = [];
  players.forEach(({ p, i }) => {
    if (p === undefined) return;
    if (draggedId !== p.id) n += 1;
    if (over !== null && draggedId !== p.id && n === over) body.push(<Marker key={`m${i}`} />);
    if (body.length > 0) body.push(<Next key={`n${i}`} />);
    body.push(<PluginItem key={p.id} p={p} hook={def.id} />);
  });
  if (over !== null && over >= players.filter((x) => x.p?.id !== draggedId).length)
    body.push(<Marker key="m-end" />);
  const replacer =
    by === undefined ? undefined : (pluginById(by) ?? m.plugins.find((q) => q.id === by));

  return (
    <div className={`${ROW} ${lit ? "bg-neutral-soft" : ""}`}>
      <Node core={isCore} />
      <div className="grid min-w-0 content-start gap-0.5 pt-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <button
            type="button"
            aria-pressed={picked}
            onClick={() => m.select({ k: "hook", id: def.id })}
            className={`min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-start outline-none focus-visible:underline ${mono ? "font-mono text-mono-sm text-text-primary" : "text-ui-strong text-text-primary"}`}
          >
            {mono ? def.id : def.label}
          </button>
          {!empty && <FoldTag fold={def.fold} />}
        </div>
        {!mono && (
          <span className="truncate font-mono text-mono-sm text-text-tertiary">{def.id}</span>
        )}
      </div>
      <div
        data-lane={def.id}
        className={`flex min-h-8 min-w-0 flex-wrap content-start items-center gap-x-1.5 gap-y-2 rounded-lg ${empty && m.drag?.over?.hook === def.id ? "outline-dashed outline-1 outline-text-primary" : ""}`}
      >
        {def.builtin !== undefined && (
          <>
            <CoreItem
              struck={by !== undefined}
              locked={false}
              picked={m.sel.k === "builtin" && m.sel.slot === slot}
              tip={null}
              onClick={() => m.select({ k: "builtin", slot })}
            />
            {replacer !== undefined ? (
              <>
                <span aria-hidden className="px-0.5 text-text-tertiary">
                  →
                </span>
                <PluginItem p={replacer} hook={def.id} replacer />
              </>
            ) : (
              <ReplacePop slot={slot} candidates={candidates} />
            )}
            {body.length > 0 && <Next />}
          </>
        )}
        {body}
        <AddPop hook={def.id} />
      </div>
    </div>
  );
}

/** 훅이 없는 코어 단계: 통째로 바꿀 수 없고 앞뒤 훅 줄에서 감싼다 */
function CoreRow({ step }: { step: CoreStep }) {
  return (
    <div className={ROW}>
      <Node core />
      <div className="grid min-w-0 content-start gap-0.5 pt-1.5">
        <span className="truncate text-ui-strong text-text-primary">{step.label}</span>
        <span className="truncate font-mono text-mono-sm text-text-tertiary">{step.id}</span>
      </div>
      <div className="flex min-h-8 items-center">
        <CoreItem locked tip={step.tip} />
      </div>
    </div>
  );
}

function CapLane({ cap }: { cap: (typeof CAPS)[number] }) {
  const m = useMock();
  const slot = capSlot(cap.id);
  const by = m.replaced[slot];
  const lit = litOf(m.sel, m.plugins, m.order).caps.has(cap.id);
  const builtin = pluginById(cap.builtin);
  const replacer = by === undefined ? undefined : pluginById(by);
  const candidates = providersOf(cap.id).filter((p) => p.id !== cap.builtin && p.id !== by);
  const picked = m.sel.k === "builtin" && m.sel.slot === slot;
  return (
    <div className={`${ROW} ${lit ? "bg-neutral-soft" : ""}`}>
      <Node core={false} />
      <button
        type="button"
        aria-pressed={picked}
        onClick={() => m.select({ k: "builtin", slot })}
        className="grid min-w-0 cursor-pointer content-start gap-0.5 border-0 bg-transparent p-0 pt-1.5 text-start outline-none focus-visible:underline"
      >
        <span className="text-ui-strong text-text-primary">{cap.label}</span>
        <span className="truncate font-mono text-mono-sm text-text-tertiary">{cap.id}</span>
      </button>
      <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-2">
        {builtin !== undefined &&
          (by !== undefined ? (
            <CoreItem struck locked={false} tip={null} />
          ) : (
            <PluginItem p={builtin} hook={null} />
          ))}
        {replacer !== undefined ? (
          <>
            <span aria-hidden className="px-0.5 text-text-tertiary">
              →
            </span>
            <PluginItem p={replacer} hook={null} replacer />
          </>
        ) : (
          <ReplacePop slot={slot} candidates={candidates} />
        )}
      </div>
    </div>
  );
}

// ── 실패 서랍 ─────────────────────────────────────────────────────
export function Drawer() {
  const m = useMock();
  const failing = m.plugins.filter((p) => m.health(p.id) !== undefined);
  const holder = pluginById(LEAD.holder);
  const k = (n: number): string => `${Math.round(n / 1000)}k`;
  return (
    <section
      aria-label={T.engine}
      className="animate-enter absolute inset-x-0 bottom-0 z-20 max-h-[62%] overflow-y-auto rounded-t-3xl border-t border-border-default bg-surface-raised shadow-3"
    >
      <header className="sticky top-0 flex h-11 items-center justify-between border-b border-border-subtle bg-surface-raised px-4">
        <h3 className="m-0 text-title-3 text-text-primary">{T.engine}</h3>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={m.closeDrawer}>
          <X />
        </IconButton>
      </header>
      <div className="grid gap-px">
        {failing.map((p) => {
          const h = m.health(p.id);
          if (h === undefined) return null;
          const open = m.drawer.focus === p.id;
          return (
            <div
              key={p.id}
              className={`border-t border-border-subtle ${open ? "bg-neutral-soft" : ""}`}
            >
              <Button
                variant="ghost"
                radius="none"
                aria-expanded={open}
                onClick={() => {
                  m.openDrawer(open ? null : p.id);
                  m.select({ k: "plugin", id: p.id });
                }}
                className="h-auto min-h-11 w-full justify-start gap-3 px-4 text-start"
              >
                <span
                  aria-hidden
                  className={`size-2 flex-none rounded-full ${h.autoOff === true ? "border border-danger-graphic" : "bg-danger-graphic"}`}
                />
                <span className="w-28 flex-none truncate text-ui-strong text-text-primary">
                  {p.name}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-mono-sm text-text-tertiary">
                  {h.hook}
                </span>
                <span className="flex-none text-footnote text-text-tertiary">{h.at}</span>
              </Button>
              {open && (
                <div className="grid gap-3 px-4 pb-3 ps-9">
                  <p className="m-0 text-body text-text-primary">{h.text}</p>
                  <div className="font-mono text-mono-sm text-text-tertiary">
                    연속 {h.fails}/{h.limit}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="xs" variant="outline" onClick={() => m.resetHealth(p.id)}>
                      다시 켜기
                    </Button>
                    {m.isOn(p.id) && (
                      <Button size="xs" variant="outline" onClick={() => m.toggle(p.id)}>
                        끄기
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" disabled>
                      실행 기록
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="px-4 pb-1 pt-3 text-footnote text-text-tertiary">{T.lead}</div>
        <div className="grid grid-cols-3 gap-x-4 border-t border-border-subtle px-4 py-3">
          <Fact label="현재 주도" value={holder?.name ?? "없음"} />
          <Fact
            label={`${T.turn} · ${T.childAgent}`}
            value={`${LEAD.turns[0]}/${LEAD.turns[1]} · ${LEAD.spawns[0]}/${LEAD.spawns[1]}`}
          />
          <Fact label="토큰" value={`${k(LEAD.tokens[0])} / ${k(LEAD.tokens[1])}`} />
        </div>
        <div className="border-t border-border-subtle px-4 py-3 text-body text-text-primary">
          <span className="text-footnote text-text-tertiary">대기열 </span>
          {LEAD.queue.map((q) => `${pluginById(q.who)?.name ?? q.who} ${q.state}`).join(" · ")}
        </div>
      </div>
    </section>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-footnote text-text-tertiary">{label}</span>
      <span className="text-body text-text-primary">{value}</span>
    </div>
  );
}

// ── 전체 ──────────────────────────────────────────────────────────
function Phase({ label }: { label: string }) {
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 px-2 pb-0.5 pt-3">
      <span aria-hidden />
      <span className="text-footnote font-medium text-text-tertiary">{label}</span>
    </div>
  );
}

export function Lanes({ rightInset }: { rightInset: number }) {
  const m = useMock();
  const [more, setMore] = useState(false);
  const failing = m.plugins.filter((p) => m.health(p.id) !== undefined).length;
  const holder = pluginById(LEAD.holder);
  return (
    <section
      aria-label="순서"
      className="absolute inset-0 overflow-y-auto"
      style={{ paddingRight: rightInset }}
    >
      <div className="mx-auto max-w-[960px] px-4 pb-24 pt-[96px]">
        <Card variant="surface" size="sm" shadow="3" className="gap-0 p-2">
          <SectionHeader
            size="sm"
            title="실행 순서"
            className="h-12 items-center px-2"
            action={
              <div className="flex items-center gap-3">
                <Chip size="lg" tone="danger" dot onClick={() => m.openDrawer(null)}>
                  실패 {failing}
                </Chip>
                <Button variant="ghost" size="sm" onClick={() => m.openDrawer(null)}>
                  {T.lead} {holder?.name ?? "없음"} · {LEAD.turns[0]}/{LEAD.turns[1]}
                </Button>
              </div>
            }
          />
          <div className="relative">
            <span
              aria-hidden
              className="absolute bottom-6 left-[20px] top-4 w-px bg-border-strong"
            />
            {PHASES.map((ph) => (
              <div key={ph.id}>
                <Phase label={ph.label} />
                {HOOKS.filter((h) => h.phase === ph.id).flatMap((h) => {
                  const core = CORE_STEPS.find((c) => c.after === h.id);
                  return [
                    <Lane key={h.id} def={h} />,
                    ...(core === undefined ? [] : [<CoreRow key={core.id} step={core} />]),
                  ];
                })}
              </div>
            ))}
            <Phase label={`${T.capability} 제공자`} />
            {CAPS.map((c) => (
              <CapLane key={c.id} cap={c} />
            ))}
            <div className="px-2 py-3">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={more}
                className="ms-9"
                onClick={() => setMore((v) => !v)}
              >
                다른 {T.hook} {OTHER_HOOKS.length}개 {more ? "접기" : "보기"}
              </Button>
            </div>
            {more &&
              OTHER_HOOKS.map((o) => (
                <Lane
                  key={o.id}
                  def={{ id: o.id, label: "", fold: o.fold, phase: "wrap", failure: "open" }}
                  mono
                />
              ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
