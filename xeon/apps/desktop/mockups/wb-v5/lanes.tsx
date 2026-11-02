// 순서: 한 턴이 흐르는 순간(훅)을 위에서 아래로, 줄마다 그 순간에 걸린 핸들러를 칩으로. 켜기·끄기, 끌어서 순서 바꾸기,
// 더하기, 내장을 플러그인으로 대체하기를 칩에서 바로 한다. 실패는 칩 자리에서 보이고 작은 서랍이 자세히 말한다.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Badge,
  Button,
  Chip,
  IconButton,
  Input,
  Popover,
  SectionHeader,
  Separator,
  Switch,
} from "@caustic/react";
import { GripVertical, Plus, Terminal, X } from "../_shell";
import { T } from "../_shell/terms";
import {
  CAPS,
  FOLD_LABEL,
  HOOKS,
  LAYER_CODE,
  LEAD,
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
import { Mark, SHAPE_OF } from "./marks";
import { litOf, useMock } from "./store";
import { vtName } from "./viewport";

const ROW =
  "grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-x-3 border-t border-border-subtle px-4 py-2.5";

// ── 칩 ────────────────────────────────────────────────────────────
// 칩 전체가 끌기 대상이다(data-chip). 켜기·실패·대체는 칩 안의 caustic 조각이다.
function PluginChip({ p, hook, replacer }: { p: Plugin; hook: string | null; replacer?: boolean }) {
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
  // 같은 플러그인이 여러 줄에 걸려도 보기 전환에서는 맨 위 줄의 칩 하나만 이름을 갖는다
  const firstHook = HOOKS.find((d) => (m.order[d.id] ?? []).includes(p.id))?.id;
  const sub = reach === "thread" ? "이 대화" : reach === "project" ? "프로젝트" : null;
  return (
    <Chip
      data-chip={p.id}
      size="lg"
      tone={isGroup ? "info" : "neutral"}
      variant={picked ? "solid" : lit ? "soft" : "outline"}
      onPointerDown={hook === null ? undefined : drag}
      style={{
        touchAction: "none",
        cursor: hook === null ? "default" : "grab",
        viewTransitionName: firstHook === hook ? vtName(p.id) : undefined,
      }}
      className={`max-w-full select-none ${on || picked ? "" : "text-text-tertiary"} ${dragging || !m.matches(p) ? "opacity-35" : ""}`}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {hook !== null && (
          <GripVertical
            aria-hidden
            className={`size-icon-xs flex-none ${picked ? "" : "opacity-40"}`}
          />
        )}
        <Switch size="xs" checked={on} onCheckedChange={() => m.toggle(p.id)} aria-label={p.name} />
        <Mark shape={SHAPE_OF[p.layer]} size={14} group={isGroup} inverse={picked} />
        <button
          type="button"
          onClick={() => m.select({ k: "plugin", id: p.id })}
          onKeyDown={onKey}
          aria-pressed={picked}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-0 bg-transparent p-0 text-start text-inherit outline-none focus-visible:underline"
        >
          <span className="truncate">{p.name}</span>
        </button>
        {h !== undefined && (
          <Chip size="xs" tone="danger" onClick={() => m.openDrawer(p.id)}>
            {h.autoOff === true ? T.autoDisabled : `실패 ${h.fails}`}
          </Chip>
        )}
        {h === undefined && sub !== null && (
          <span
            className={`whitespace-nowrap text-footnote ${picked ? "opacity-70" : "text-text-tertiary"}`}
          >
            {sub}
          </span>
        )}
        {replacer === true && <Badge size="xs">대체</Badge>}
      </span>
    </Chip>
  );
}

function BuiltinChip({ name, struck, slot }: { name: string; struck: boolean; slot: string }) {
  const m = useMock();
  const picked = m.sel.k === "builtin" && m.sel.slot === slot;
  return (
    <Chip
      variant="dashed"
      size="lg"
      pressed={picked}
      onClick={() => m.select({ k: "builtin", slot })}
    >
      <span className={struck ? "line-through opacity-70" : ""}>{name}</span>
      <span className="text-footnote text-text-tertiary">내장</span>
    </Chip>
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
      radius="lg"
      align="start"
      arrow={false}
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
        <Chip variant="dashed" size="lg" icon={<Plus />}>
          더하기
        </Chip>
      }
      label="더하기"
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
                    radius="md"
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
              m.create({ name: text, hook, template: null, reach: "project", command: text });
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
              걸기
            </Button>
          </form>
          <Separator variant="soft" />
          <Button
            variant="ghost"
            size="sm"
            radius="md"
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
            radius="md"
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

function Lane({ def, mono }: { def: HookDef; mono?: boolean }) {
  const m = useMock();
  const lit = litOf(m.sel, m.plugins, m.order).hooks.has(def.id);
  const picked = m.sel.k === "hook" && m.sel.id === def.id;
  const ids = m.order[def.id] ?? [];
  const slot = hookSlot(def.id);
  const by = m.replaced[slot];
  // 순서가 결과를 정하는 줄(막기·고치기)만 번호를 단다.
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
    body.push(<PluginChip key={p.id} p={p} hook={def.id} />);
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
          <span className="text-ui-strong text-text-primary">
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
        className={`flex min-h-8 min-w-0 flex-wrap content-start items-center gap-2 rounded-lg ${empty && m.drag?.over?.hook === def.id ? "outline-dashed outline-1 outline-text-primary" : ""}`}
      >
        {def.builtin !== undefined && (
          <>
            <BuiltinChip name={def.builtin} struck={by !== undefined} slot={slot} />
            {replacer !== undefined ? (
              <>
                <span aria-hidden className="text-text-tertiary">
                  →
                </span>
                <PluginChip p={replacer} hook={def.id} replacer />
              </>
            ) : (
              <ReplacePop slot={slot} candidates={candidates} />
            )}
          </>
        )}
        {body}
        {empty && <span className="text-ui-sm text-text-tertiary">비어 있음</span>}
        <AddPop hook={def.id} />
        {empty && (
          <Chip variant="dashed" size="lg" icon={<Plus />} onClick={() => m.openBuilder(def.id)}>
            만들기
          </Chip>
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
            <PluginChip p={builtin} hook={null} />
          ))}
        {replacer !== undefined ? (
          <>
            <span aria-hidden className="text-text-tertiary">
              →
            </span>
            <PluginChip p={replacer} hook={null} replacer />
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
      className="animate-enter absolute inset-x-0 bottom-0 z-20 max-h-[62%] overflow-y-auto rounded-t-lg border-t border-border-default bg-surface-raised shadow-3"
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
        <SectionHeader
          size="sm"
          title="순서"
          className="h-12 items-center px-4"
          action={
            <div className="flex items-center gap-4">
              <Chip size="lg" tone="danger" dot onClick={() => m.openDrawer(null)}>
                실패 {failing}
              </Chip>
              <Button variant="ghost" size="sm" onClick={() => m.openDrawer(null)}>
                {T.lead} {holder?.name ?? "없음"} · {LEAD.turns[0]}/{LEAD.turns[1]}
              </Button>
            </div>
          }
        />
        <div>
          {PHASES.map((ph) => (
            <div key={ph.id}>
              <div className="flex items-center gap-3 px-4 pb-1.5 pt-3 text-footnote text-text-tertiary">
                {ph.label}
                <Separator variant="soft" className="flex-1" />
              </div>
              {HOOKS.filter((h) => h.phase === ph.id).map((h) => (
                <Lane key={h.id} def={h} />
              ))}
            </div>
          ))}
          <div className="flex items-center gap-3 px-4 pb-1.5 pt-3 text-footnote text-text-tertiary">
            {T.capability} 제공자
            <Separator variant="soft" className="flex-1" />
          </div>
          {CAPS.map((c) => (
            <CapLane key={c.id} cap={c} />
          ))}
          <div className="border-t border-border-subtle px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={more}
              className="-ms-2.5"
              onClick={() => setMore((v) => !v)}
            >
              다른 {T.hook} {OTHER_HOOKS.length} {more ? "접기" : "보기"}
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
      </div>
    </section>
  );
}
