// 좁은 폭(720px 이하): 캔버스 대신 개요 편집기. 그룹은 caustic LayerTree(블록 → 훅·기능·출력), 끌어 옮기면 쌓는 순서가
// 바뀐다. 흐름은 단계 목록(전이 조건을 들여 씀). 같은 데이터, 같은 검사 결과를 글줄로 보인다.
import { LayerTree, LayerTreeItem, type LayerTreeAnnouncement } from "@caustic/react";
import { ArrowRight, CircleAlert, CircleDot, FileText, Plug } from "../../_shell";
import { helmBlocks, invalidBlocks, lenses } from "../fixtures";
import { SLOT_ICON } from "../parts/blocks";
import { useMock } from "../store";

const announce = (e: LayerTreeAnnouncement) =>
  e.type === "moved"
    ? `${e.names.join(", ")}을 옮겼어요`
    : e.type === "selected"
      ? `${e.names.join(", ")} 고름`
      : "";

export function GroupOutline() {
  const m = useMock();
  const blocks = m.group === "lens-review" ? invalidBlocks : helmBlocks;
  const name = m.group === "lens-review" ? "lens-review" : "helm";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
      <LayerTree
        aria-label={`${name} 블록 개요`}
        announce={announce}
        size="sm"
        value={m.selected !== null ? [m.selected] : []}
        onValueChange={(v) => m.set({ selected: v[0] ?? null })}
        defaultExpanded={["scope", ...blocks.map((b) => b.id)]}
      >
        <LayerTreeItem
          itemId="scope"
          depth={0}
          icon={SLOT_ICON.scope}
          label={name}
          caption={`L3 · 블록 ${blocks.length}`}
          expandable
          open
        />
        {blocks.flatMap((b) => [
          <LayerTreeItem
            key={b.id}
            itemId={b.id}
            depth={1}
            icon={b.issue?.level === "error" ? <CircleAlert /> : SLOT_ICON[b.slot]}
            label={b.title}
            caption={b.op}
            tag={b.issue !== undefined ? b.issue.code : undefined}
            expandable={b.points.length + b.consumes.length + b.produces.length > 0}
            open
          />,
          ...b.points.map((p) => (
            <LayerTreeItem
              key={`${b.id}-${p.point}`}
              itemId={`${b.id}-${p.point}`}
              depth={2}
              icon={<CircleDot />}
              label={p.point}
              caption={p.fold}
            />
          )),
          ...b.consumes.map((c) => (
            <LayerTreeItem
              key={`${b.id}-${c.cap}`}
              itemId={`${b.id}-${c.cap}`}
              depth={2}
              icon={<Plug />}
              label={c.cap}
              caption={c.provider === null ? "provider 없음" : `← ${c.provider}`}
            />
          )),
          ...b.produces.map((o) => (
            <LayerTreeItem
              key={`${b.id}-${o.id}`}
              itemId={`${b.id}-${o.id}`}
              depth={2}
              icon={<FileText />}
              label={o.label}
              caption="출력"
            />
          )),
        ])}
      </LayerTree>
    </div>
  );
}

const STEPS: { id: string; title: string; meta: string; next: string[] }[] = [
  { id: "idle", title: "idle", meta: "신호 대기", next: ["leaseGranted · pending → diverge"] },
  {
    id: "diverge",
    title: "diverge",
    meta: "턴 1 · 쓰기 거부",
    next: ["diverged → explore", "aborted · error · 턴 0 → 끝"],
  },
  {
    id: "explore",
    title: "explore",
    meta: "spawn 3 · 쓰기 거부",
    next: ["explored(done ≥ 1) → converge", "모든 렌즈 실패 · spawn 0 → 끝"],
  },
  {
    id: "converge",
    title: "converge",
    meta: "턴 0 · 읽기 기능",
    next: ["converged(발견 ≥ 1) → apply", "발견 0 → 끝"],
  },
  { id: "apply", title: "apply", meta: "턴 1", next: ["applied → 끝"] },
];

export function FlowOutline() {
  return (
    <ol className="m-0 grid min-h-0 flex-1 list-none content-start gap-3 overflow-y-auto px-3 pb-4">
      {STEPS.map((s) => (
        <li key={s.id} className="grid gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-mono-strong text-text-primary">{s.title}</span>
            <span className="text-ui-xs text-text-tertiary">{s.meta}</span>
          </span>
          {s.id === "explore" && (
            <span className="ps-3 text-ui-xs text-text-secondary">
              자식 {lenses.map((l) => l.id).join(" · ")}
            </span>
          )}
          {s.next.map((n) => (
            <span key={n} className="flex items-center gap-1 ps-3 text-ui-xs text-text-secondary">
              <ArrowRight aria-hidden className="size-icon-xs text-text-tertiary" />
              {n}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}
