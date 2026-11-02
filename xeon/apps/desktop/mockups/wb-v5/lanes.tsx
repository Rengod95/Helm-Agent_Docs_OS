// 순서: 한 턴이 흐르는 순간(훅)을 위에서 아래로, 줄마다 그 순간에 걸린 핸들러를 칩으로. 켜기·끄기, 끌어서 순서 바꾸기,
// 더하기, 내장을 플러그인으로 대체하기를 칩에서 바로 한다. 실패는 칩 자리에서 보이고 작은 서랍이 자세히 말한다.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, IconButton } from "@caustic/react";
import { X } from "../_shell";
import { T } from "../_shell/terms";
import {
  CAPS,
  FOLD_LABEL,
  HOOKS,
  LEAD,
  LAYER_CODE,
  OTHER_HOOKS,
  PHASES,
  capSlot,
  hookSlot,
  pluginById,
  providersOf,
  type HookDef,
  type Plugin,
} from "./data";
import { useDragSource } from "./drag";
import { GRP, Mark, SHAPE_OF } from "./marks";
import { litOf, useMock } from "./store";

const ROW =
  "grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-x-3 border-t border-border-subtle px-4 py-2.5";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: PointerEvent): void => {
      if (ref.current !== null && e.target instanceof Node && !ref.current.contains(e.target))
        close();
    };
    const key = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open, close]);
  return ref;
}

// ── 칩 ────────────────────────────────────────────────────────────
function Chip({
  p,
  hook,
  index,
  ordered,
  replacer,
}: {
  p: Plugin;
  hook: string | null;
  index: number;
  ordered: boolean;
  replacer?: boolean;
}) {
  const m = useMock();
  const picked = m.sel.k === "plugin" && m.sel.id === p.id;
  const lit = litOf(m.sel, m.plugins, m.order).plugins.has(p.id);
  const on = m.isOn(p.id);
  const h0 = m.health(p.id);
  const h = h0 !== undefined && (hook === null || h0.hook === hook) ? h0 : undefined;
  const reach = m.reach(p.id);
  const drag = useDragSource({ id: p.id, from: hook, label: p.name });
  const dragging = m.drag?.id === p.id && m.drag.from === hook;
  const lane = hook === null ? [] : (m.order[hook] ?? []);
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
  const isGroup = p.group !== undefined;
  const sub = reach === "thread" ? "이 대화" : reach === "project" ? "프로젝트" : null;
  return (
    <div
      data-chip={p.id}
      onPointerDown={hook === null ? undefined : drag}
      className={`group/chip inline-flex h-8 max-w-full select-none items-center gap-1.5 rounded-full border pe-3 ps-1.5 text-ui-sm ${
        picked
          ? "border-text-primary bg-text-primary text-surface-base shadow-[0_0_0_3px_var(--cs-color-surface-base),0_0_0_4.5px_var(--cs-color-border-default)]"
          : `${isGroup ? "" : "bg-surface-base"} ${isGroup ? "" : lit ? "border-text-primary" : "border-border-default"} ${on ? "text-text-primary" : "text-text-tertiary"}`
      } ${dragging ? "opacity-35" : ""} ${!m.matches(p) ? "opacity-35" : ""}`}
      style={{
        touchAction: "none",
        cursor: hook === null ? "default" : "grab",
        ...(isGroup && !picked
          ? { background: GRP.soft, borderColor: lit ? GRP.graphic : GRP.border }
          : {}),
      }}
    >
      {hook !== null ? (
        <span
          aria-hidden
          className={`grid w-3 flex-none grid-cols-2 gap-[2px] px-[1px] ${picked ? "opacity-70" : "opacity-40"}`}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="size-[3px] rounded-full bg-current" />
          ))}
        </span>
      ) : (
        <span aria-hidden className="w-1" />
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${p.name} ${on ? "끄기" : "켜기"}`}
        onClick={() => m.toggle(p.id)}
        className="grid size-4 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
      >
        <Mark
          shape={SHAPE_OF[p.layer]}
          size={18}
          on={on}
          group={isGroup}
          failing={h !== undefined}
          autoOff={h?.autoOff === true}
          inverse={picked}
        />
      </button>
      <button
        type="button"
        onClick={() => m.select({ k: "plugin", id: p.id })}
        onKeyDown={onKey}
        aria-pressed={picked}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-0 bg-transparent p-0 text-start text-inherit outline-none focus-visible:underline"
      >
        <span className="truncate">{p.name}</span>
        {ordered && (
          <span
            className={`font-mono text-mono-sm ${picked ? "opacity-70" : "text-text-tertiary"}`}
          >
            {index + 1}
          </span>
        )}
      </button>
      {h !== undefined && (
        <button
          type="button"
          onClick={() => m.openDrawer(p.id)}
          className={`cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-footnote outline-none focus-visible:underline ${picked ? "text-surface-base" : "text-danger-text"}`}
        >
          · {h.autoOff === true ? T.autoDisabled : `실패 ${h.fails}`}
        </button>
      )}
      {h === undefined && sub !== null && (
        <span
          className={`whitespace-nowrap text-footnote ${picked ? "opacity-70" : "text-text-tertiary"}`}
        >
          · {sub}
        </span>
      )}
      {replacer === true && (
        <span
          className={`whitespace-nowrap rounded-full px-1.5 text-footnote ${picked ? "bg-surface-base text-text-primary" : "bg-text-primary text-surface-base"}`}
        >
          대체
        </span>
      )}
    </div>
  );
}

function BuiltinChip({ name, struck, slot }: { name: string; struck: boolean; slot: string }) {
  const m = useMock();
  const picked = m.sel.k === "builtin" && m.sel.slot === slot;
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={() => m.select({ k: "builtin", slot })}
      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed bg-transparent px-3 text-ui-sm outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] ${
        picked
          ? "border-text-primary text-text-primary"
          : "border-border-strong text-text-secondary"
      }`}
    >
      <span className={struck ? "line-through opacity-70" : ""}>{name}</span>
      <span className="text-footnote text-text-tertiary">내장</span>
    </button>
  );
}

// ── 더하기·대체 팝오버 ────────────────────────────────────────────
function Pop({
  children,
  label,
  className = "",
}: {
  children: (close: () => void) => ReactNode;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border-strong bg-transparent px-3 text-ui-sm text-text-secondary outline-none hover:bg-neutral-hover focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] ${className}`}
      >
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="animate-enter absolute left-0 top-9 z-30 grid w-64 gap-0.5 rounded-2xl border border-border-default bg-surface-raised p-1.5 shadow-3"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
const ITEM =
  "flex min-h-8 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border-0 bg-transparent px-3 text-start text-body text-text-primary outline-none hover:bg-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]";

function AddPop({ hook }: { hook: string }) {
  const m = useMock();
  const [cmd, setCmd] = useState("");
  const lane = m.order[hook] ?? [];
  const rest = m.plugins.filter((p) => !lane.includes(p.id) && p.layer !== "L2");
  return (
    <Pop label="+ 더하기">
      {(close) => (
        <>
          <span className="px-3 pt-1 text-footnote text-text-tertiary">설치한 것</span>
          <div className="grid max-h-40 gap-0.5 overflow-y-auto">
            {rest.map((p) => (
              <button
                key={p.id}
                type="button"
                className={ITEM}
                onClick={() => {
                  m.addToLane(hook, p.id);
                  close();
                }}
              >
                <span className="truncate">{p.name}</span>
                <span className="flex-none text-footnote text-text-tertiary">
                  {m.isOn(p.id) ? LAYER_CODE[p.layer] : "꺼짐"}
                </span>
              </button>
            ))}
          </div>
          <span className="px-3 pt-1.5 text-footnote text-text-tertiary">{T.hook} 명령 하나</span>
          <form
            className="flex items-center gap-1.5 px-1.5 pb-1"
            onSubmit={(e) => {
              e.preventDefault();
              const text = cmd.trim();
              if (text === "") return;
              m.create({ name: text, hook, template: null, reach: "project", command: text });
              setCmd("");
              close();
            }}
          >
            <input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder="./check.sh"
              aria-label={`${hook}에 걸 명령`}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border-default bg-surface-base px-2.5 font-mono text-mono-sm text-text-primary outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
            />
            <Button size="xs" variant="outline" type="submit" disabled={cmd.trim() === ""}>
              걸기
            </Button>
          </form>
          <button
            type="button"
            className={`${ITEM} border-t border-border-subtle`}
            onClick={() => {
              m.openBuilder(hook);
              close();
            }}
          >
            <span>새로 만들기</span>
            <span className="text-footnote text-text-tertiary">{T.authoringExt}</span>
          </button>
        </>
      )}
    </Pop>
  );
}

function ReplacePop({ slot, candidates }: { slot: string; candidates: Plugin[] }) {
  const m = useMock();
  if (candidates.length === 0) return null;
  return (
    <Pop label="대체">
      {(close) => (
        <>
          <span className="px-3 pt-1 text-footnote text-text-tertiary">이것으로 대체</span>
          {candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              className={ITEM}
              onClick={() => {
                m.replace(slot, p.id);
                close();
              }}
            >
              <span className="truncate">{p.name}</span>
              <span className="flex-none text-footnote text-text-tertiary">{p.version}</span>
            </button>
          ))}
        </>
      )}
    </Pop>
  );
}

// ── 줄 ────────────────────────────────────────────────────────────
function Marker() {
  return <span aria-hidden className="h-8 w-0.5 flex-none rounded-full bg-text-primary" />;
}

function Lane({ def, mono }: { def: HookDef; mono?: boolean }) {
  const m = useMock();
  const lit = litOf(m.sel, m.plugins, m.order).hooks.has(def.id);
  const picked = m.sel.k === "hook" && m.sel.id === def.id;
  const ids = m.order[def.id] ?? [];
  const slot = hookSlot(def.id);
  const by = m.replaced[slot];
  const ordered = def.fold === "first" || def.fold === "chain";
  const over = m.drag?.over?.hook === def.id ? m.drag.over.index : null;
  const draggedId = m.drag?.over?.hook === def.id || m.drag?.from === def.id ? m.drag.id : null;
  const shown = ids.filter((id) => id !== by);
  const candidates = m.plugins.filter((p) => p.hooks.includes(def.id) && p.id !== by);
  const players = shown.map((id, i) => ({
    p: pluginById(id) ?? m.plugins.find((q) => q.id === id),
    i,
  }));
  const empty = def.builtin === undefined && ids.length === 0;
  let n = -1;
  const body: ReactNode[] = [];
  players.forEach(({ p, i }) => {
    if (p === undefined) return;
    if (draggedId !== p.id) n += 1;
    if (over !== null && draggedId !== p.id && n === over) body.push(<Marker key={`m${i}`} />);
    body.push(<Chip key={p.id} p={p} hook={def.id} index={i} ordered={ordered} />);
  });
  if (over !== null && over >= players.filter((x) => x.p?.id !== draggedId).length)
    body.push(<Marker key="m-end" />);
  const replacer =
    by === undefined ? undefined : (pluginById(by) ?? m.plugins.find((q) => q.id === by));

  return (
    <div className={`${ROW} ${lit ? "bg-neutral-soft" : ""}`}>
      <button
        type="button"
        aria-pressed={picked}
        onClick={() => m.select({ k: "hook", id: def.id })}
        className="grid min-w-0 cursor-pointer content-start gap-0.5 border-0 bg-transparent p-0 text-start outline-none focus-visible:underline"
      >
        {!mono && (
          <span
            className={`text-ui-strong ${picked || lit ? "text-text-primary" : "text-text-primary"}`}
          >
            {def.label}{" "}
            <span className="font-normal text-text-tertiary">· {FOLD_LABEL[def.fold]}</span>
          </span>
        )}
        <span
          className={`truncate font-mono text-mono-sm ${mono ? "text-text-primary" : "text-text-tertiary"}`}
        >
          {def.id}
          {mono && <span className="font-sans text-text-tertiary"> · {FOLD_LABEL[def.fold]}</span>}
        </span>
      </button>
      <div
        data-lane={def.id}
        className={`flex min-h-8 min-w-0 flex-wrap content-start items-center gap-2 rounded-2xl ${empty && m.drag?.over?.hook === def.id ? "outline-dashed outline-1 outline-text-primary" : ""}`}
      >
        {def.builtin !== undefined && (
          <>
            <BuiltinChip name={def.builtin} struck={by !== undefined} slot={slot} />
            {replacer !== undefined ? (
              <>
                <span aria-hidden className="text-text-tertiary">
                  →
                </span>
                <Chip p={replacer} hook={def.id} index={0} ordered={false} replacer />
              </>
            ) : (
              <ReplacePop slot={slot} candidates={candidates} />
            )}
          </>
        )}
        {body}
        {empty ? (
          <div className="flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-full border border-dashed border-border-strong ps-4 pe-1 text-ui-sm text-text-tertiary">
            비어 있음
            <span className="flex items-center gap-1.5">
              <AddPop hook={def.id} />
              <button
                type="button"
                onClick={() => m.openBuilder(def.id)}
                className="inline-flex h-8 cursor-pointer items-center whitespace-nowrap rounded-full border border-dashed border-border-strong bg-transparent px-3 text-ui-sm text-text-secondary outline-none hover:bg-neutral-hover focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
              >
                + 만들기
              </button>
            </span>
          </div>
        ) : (
          <AddPop hook={def.id} />
        )}
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
      <button
        type="button"
        aria-pressed={picked}
        onClick={() => m.select({ k: "builtin", slot })}
        className="grid min-w-0 cursor-pointer content-start gap-0.5 border-0 bg-transparent p-0 text-start outline-none focus-visible:underline"
      >
        <span className="text-ui-strong text-text-primary">{cap.label}</span>
        <span className="truncate font-mono text-mono-sm text-text-tertiary">{cap.id}</span>
      </button>
      <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-2">
        {builtin !== undefined &&
          (by !== undefined ? (
            <BuiltinChip name={builtin.name} struck slot={slot} />
          ) : (
            <Chip p={builtin} hook={null} index={0} ordered={false} />
          ))}
        {replacer !== undefined ? (
          <>
            <span aria-hidden className="text-text-tertiary">
              →
            </span>
            <Chip p={replacer} hook={null} index={0} ordered={false} replacer />
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
      className="animate-enter absolute inset-x-0 bottom-0 z-20 max-h-[62%] overflow-y-auto rounded-t-[24px] border-t border-border-default bg-surface-raised shadow-3"
    >
      <header className="sticky top-0 flex h-11 items-center justify-between border-b border-border-subtle bg-surface-raised px-4">
        <h3 className="m-0 text-title-3 text-text-primary">{T.engine}</h3>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={m.closeDrawer}>
          <X />
        </IconButton>
      </header>
      <div className="grid gap-px">
        <div className="px-4 pb-1 pt-3 text-footnote text-text-tertiary">
          {T.extFailed} {failing.length}
        </div>
        {failing.map((p) => {
          const h = m.health(p.id);
          if (h === undefined) return null;
          const open = m.drawer.focus === p.id;
          return (
            <div
              key={p.id}
              className={`border-t border-border-subtle ${open ? "bg-neutral-soft" : ""}`}
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                  m.openDrawer(open ? null : p.id);
                  m.select({ k: "plugin", id: p.id });
                }}
                className="flex min-h-11 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-start outline-none hover:bg-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]"
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
              </button>
              {open && (
                <div className="grid gap-3 px-4 pb-3 ps-9">
                  <p className="m-0 text-body text-text-primary">{h.text}</p>
                  <div className="font-mono text-mono-sm text-text-tertiary">
                    연속 {h.fails}/{h.limit} · {T.autoDisabled} 기준
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
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => m.notify("실행 기록은 아직 모형이에요")}
                    >
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
          <Fact label="쥔 곳" value={holder?.name ?? "없음"} />
          <Fact
            label={`${T.turn} · ${T.childAgent}`}
            value={`${LEAD.turns[0]}/${LEAD.turns[1]} · ${LEAD.spawns[0]}/${LEAD.spawns[1]}`}
          />
          <Fact label="토큰" value={`${k(LEAD.tokens[0])} / ${k(LEAD.tokens[1])}`} />
        </div>
        <div className="border-t border-border-subtle px-4 py-3 text-body text-text-primary">
          <span className="text-footnote text-text-tertiary">{T.leadQueue} </span>
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
export function Lanes({ rightInset }: { rightInset: number }) {
  const m = useMock();
  const [more, setMore] = useState(false);
  const failing = m.plugins.filter((p) => m.health(p.id) !== undefined).length;
  const holder = pluginById(LEAD.holder);
  return (
    <section
      aria-label="순서"
      className="absolute inset-0 overflow-y-auto bg-surface-base"
      style={{ paddingRight: rightInset }}
    >
      <div className="mx-auto max-w-[1040px] pb-8 pt-[108px]">
        <header className="flex h-12 flex-none items-center justify-between gap-3 px-4">
          <h2 className="m-0 text-title-3 text-text-primary">순서</h2>
          <div className="flex items-center gap-4 text-body text-text-secondary">
            <button
              type="button"
              onClick={() => m.openDrawer(null)}
              className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-body text-text-primary outline-none focus-visible:underline"
            >
              <span aria-hidden className="size-1.5 rounded-full bg-danger-graphic" />
              실패 {failing}
            </button>
            <button
              type="button"
              onClick={() => m.openDrawer(null)}
              className="cursor-pointer border-0 bg-transparent p-0 text-body text-text-primary outline-none focus-visible:underline"
            >
              {T.lead} {holder?.name ?? "없음"} · {LEAD.turns[0]}/{LEAD.turns[1]}
            </button>
          </div>
        </header>
        <div>
          {PHASES.map((ph) => (
            <div key={ph.id}>
              <div className="flex items-center gap-3 px-4 pb-1.5 pt-3 text-footnote text-text-tertiary">
                {ph.label}
                <span aria-hidden className="h-px flex-1 bg-border-subtle" />
              </div>
              {HOOKS.filter((h) => h.phase === ph.id).map((h) => (
                <Lane key={h.id} def={h} />
              ))}
            </div>
          ))}
          <div className="flex items-center gap-3 px-4 pb-1.5 pt-3 text-footnote text-text-tertiary">
            {T.capability} 제공자
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
          </div>
          {CAPS.map((c) => (
            <CapLane key={c.id} cap={c} />
          ))}
          <div className="border-t border-border-subtle px-4 py-3">
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore((v) => !v)}
              className="cursor-pointer border-0 bg-transparent p-0 text-body text-text-secondary outline-none hover:text-text-primary focus-visible:underline"
            >
              다른 {T.hook} {OTHER_HOOKS.length} {more ? "접기" : "보기"}
            </button>
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
      </div>
    </section>
  );
}
