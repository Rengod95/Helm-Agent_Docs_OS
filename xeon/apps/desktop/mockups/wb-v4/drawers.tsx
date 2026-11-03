// 서랍 둘. 왼쪽 = 설치한 확장(그룹 › 플러그인 트리, 거르기, 가져오기). 아래 = 엔진 상태(실패는 칸과 훅으로 이어짐, 주도, 지표).
import { Button, IconButton, Input, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useState } from "react";
import { X } from "../_shell/icons";
import { T } from "../_shell/terms";
import { metrics, tests } from "../_shell/workbench-fixtures";
import {
  FAILURES,
  GROUPS,
  GROUP_MEMBERS,
  LEASE,
  PLUGINS,
  pluginById,
  stageOfPoint,
  stageOf,
  type Plugin,
  type Unit,
} from "./data";
import { useMock } from "./store";

const cn = (...p: Array<string | false | null | undefined>): string =>
  p.filter((x): x is string => typeof x === "string" && x !== "").join(" ");

const isExtension = (p: Plugin): boolean => p.locked !== true && p.kind !== "contract";
type Filter = "all" | "user" | "attention";

function unitOf(p: Plugin): Unit {
  return p.kind === "group" ? { kind: "group", id: p.id } : { kind: "plugin", id: p.id };
}

export function ExtensionTree() {
  const m = useMock();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({ helm: true });
  const [install, setInstall] = useState(false);

  const pass = (p: Plugin): boolean => {
    if (q.trim() !== "" && !p.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === "user") return p.origin !== "builtin";
    if (filter === "attention") return p.health !== "ok";
    return true;
  };
  const inGroup = new Set(Object.values(GROUP_MEMBERS).flat());
  const loose = PLUGINS.filter((p) => isExtension(p) && p.kind !== "group" && !inGroup.has(p.id));

  const row = (p: Plugin, depth: number) => {
    const e = m.eff(p);
    const on =
      (m.unit.kind === "group" || m.unit.kind === "plugin") && m.unit.id === p.id;
    return (
      <button
        key={`${depth}-${p.id}`}
        type="button"
        onClick={() => m.setUnit(unitOf(p))}
        aria-current={on ? "true" : undefined}
        className={cn(
          "flex min-h-8 w-full cursor-pointer items-center gap-2 pe-3 text-start text-body outline-none hover:bg-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]",
          on && "bg-neutral-soft font-semibold",
          e.on ? "text-text-primary" : "text-text-tertiary",
        )}
        style={{ paddingInlineStart: `${16 + depth * 16}px` }}
      >
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        {p.health !== "ok" && (
          <span
            aria-label={p.health === "auto_off" ? T.autoDisabled : T.extFailed}
            className={cn(
              "size-1.5 flex-none rounded-full",
              p.health === "auto_off" ? "bg-danger-graphic" : "bg-warning-graphic",
            )}
          />
        )}
        {p.origin !== "builtin" && (
          <span className="flex-none text-footnote text-text-tertiary">
            {p.origin === "user" ? T.trustUser : T.trustProject}
          </span>
        )}
      </button>
    );
  };

  const groupNodes = GROUPS.map((g) => {
    const kids = (GROUP_MEMBERS[g.id] ?? []).map(pluginById).filter((p) => isExtension(p) && pass(p));
    if (!pass(g) && kids.length === 0) return null;
    const expanded = open[g.id] === true || q.trim() !== "";
    return (
      <div key={g.id} className="border-b border-border-subtle">
        <div className="flex items-center">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${g.name} 펼치기`}
            onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))}
            className="flex size-8 flex-none cursor-pointer items-center justify-center text-text-tertiary outline-none hover:text-text-primary focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]"
          >
            <span aria-hidden className={cn("transition-transform", expanded && "rotate-90")}>
              ›
            </span>
          </button>
          <div className="min-w-0 flex-1">{row(g, 0)}</div>
        </div>
        {expanded && kids.map((p) => row(p, 3))}
      </div>
    );
  });
  const looseRows = loose.filter(pass);

  return (
    <aside
      aria-label={T.extension}
      className="absolute inset-y-0 start-0 z-10 flex min-h-0 w-64 flex-col border-e border-border-subtle bg-bg-app shadow-3"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h2 className="text-title-3 text-text-primary">{T.extension}</h2>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={() => m.setDrawer("none")}>
          <X />
        </IconButton>
      </div>
      <div className="grid gap-2 px-4 py-2">
        <Input size="sm" aria-label="확장 찾기" placeholder="찾기" value={q} onValueChange={setQ} />
        <SegmentedControl
          aria-label="거르기"
          size="sm"
          value={filter}
          onValueChange={(v) => setFilter(v === "user" ? "user" : v === "attention" ? "attention" : "all")}
          className="w-full [&>[data-slot=segmented-control-item]]:flex-1 [&_[data-state=checked]]:font-semibold"
        >
          <SegmentedControlItem value="all">전체</SegmentedControlItem>
          <SegmentedControlItem value="user">설치</SegmentedControlItem>
          <SegmentedControlItem value="attention">주의</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-subtle">
        {groupNodes}
        {looseRows.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1 text-footnote text-text-tertiary">{T.group} 밖</div>
            {looseRows.map((p) => row(p, 0))}
          </div>
        )}
      </div>
      <div className="border-t border-border-subtle p-3">
        {install ? (
          <div className="grid gap-2">
            <Button size="sm" variant="outline" onClick={() => { m.notify(`${T.installFolder}: ${T.installCheck} 뒤 켜요`); setInstall(false); }}>
              {T.installFolder}에서
            </Button>
            <Button size="sm" variant="outline" onClick={() => { m.notify(`${T.installBundle}: ${T.installCheck} 뒤 켜요`); setInstall(false); }}>
              {T.installBundle}에서
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setInstall(false)}>
              닫기
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setInstall(true)}>
            {T.install}
          </Button>
        )}
      </div>
    </aside>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  return (
    <div className="grid min-w-0 gap-0.5 px-4 py-2">
      <span className="text-footnote text-text-tertiary">{label}</span>
      <span
        className={cn(
          "truncate text-body",
          tone === "danger" ? "text-danger-text" : tone === "warning" ? "text-warning-text" : "text-text-primary",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** 아래 서랍: 접으면 한 줄 요약, 펼치면 실패(칸으로 이어짐) · 주도 · 지표. */
export function HealthDrawer() {
  const m = useMock();
  const failing = FAILURES.length;
  const tokens = `${Math.round(LEASE.tokens[0] / 1000)}k / ${Math.round(LEASE.tokens[1] / 1000)}k`;
  const run = tests.find((t) => t.result === "running");
  return (
    <section aria-label="엔진 상태" className="flex-none border-t border-border-subtle bg-bg-app">
      <button
        type="button"
        aria-expanded={m.health}
        onClick={() => m.setHealth(!m.health)}
        className="flex min-h-10 w-full cursor-pointer items-center gap-6 px-4 text-start outline-none hover:bg-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]"
      >
        <span className="text-title-3 text-text-primary">{T.engine}</span>
        <span className="text-body text-text-primary">
          {T.lead} {LEASE.holder === null ? "없음" : pluginById(LEASE.holder).name} · {T.turn} {LEASE.turns[0]}/{LEASE.turns[1]}
        </span>
        <span className="flex items-center gap-1.5 text-body text-text-primary">
          <span aria-hidden className="size-1.5 rounded-full bg-warning-graphic" />
          {T.extFailed} {failing}
        </span>
        {run !== undefined && <span className="text-body text-text-tertiary">{T.trialThread} 1 · {run.took}</span>}
        <span aria-hidden className={cn("ms-auto text-text-tertiary transition-transform", m.health ? "rotate-90" : "-rotate-90")}>
          ›
        </span>
      </button>
      {m.health && (
        <div className="grid max-h-60 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] overflow-y-auto border-t border-border-subtle max-[900px]:grid-cols-1">
          <div className="min-w-0">
            <div className="px-4 pt-2 text-footnote text-text-tertiary">실패</div>
            {FAILURES.map((f) => {
              const p = pluginById(f.plugin);
              const stage = stageOfPoint(f.point);
              return (
                <button
                  key={`${f.plugin}:${f.point}`}
                  type="button"
                  onClick={() => {
                    m.setUnit(unitOf(p));
                    m.select({ kind: "hook", plugin: p.id, point: f.point });
                  }}
                  className="flex min-h-10 w-full cursor-pointer items-center gap-3 px-4 py-1.5 text-start outline-none hover:bg-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]"
                >
                  <span className="w-24 flex-none truncate text-body text-text-primary">{p.name}</span>
                  <span className="w-20 flex-none truncate text-footnote text-text-tertiary">{stageOf(stage).label}</span>
                  <span className="min-w-0 flex-1 truncate text-body text-text-primary">{f.text}</span>
                  <span className="flex-none text-footnote text-text-tertiary">{f.at}</span>
                </button>
              );
            })}
          </div>
          <div className="min-w-0 border-s border-border-subtle max-[900px]:border-s-0 max-[900px]:border-t">
            <div className="px-4 pt-2 text-footnote text-text-tertiary">{T.lead}</div>
            <div className="grid grid-cols-2">
            <Cell label="쥔 곳" value={LEASE.holder === null ? "없음" : pluginById(LEASE.holder).name} />
            <Cell label={`${T.turn} · ${T.childAgent}`} value={`${LEASE.turns[0]}/${LEASE.turns[1]} · ${LEASE.spawns[0]}/${LEASE.spawns[1]}`} />
            <Cell label="토큰" value={tokens} />
            <Cell
              label={T.leadQueue}
              value={LEASE.queue.map((q) => `${pluginById(q.group).name} ${q.state === "waiting" ? "기다림" : "거절"}`).join(" · ")}
            />
            </div>
          </div>
          <div className="min-w-0 border-s border-border-subtle max-[900px]:border-s-0 max-[900px]:border-t">
            <div className="px-4 pt-2 text-footnote text-text-tertiary">{T.metrics}</div>
            {metrics.map((x) => (
              <div key={x.name} className="flex min-h-9 items-center justify-between gap-3 px-4 py-1.5">
                <span className="text-body text-text-primary">{pluginById(x.name === "helm" ? "helm" : x.name).name}</span>
                <span className="text-footnote text-text-tertiary">
                  {Math.round(x.tokens / 1000)}k · ${x.costUsd.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
