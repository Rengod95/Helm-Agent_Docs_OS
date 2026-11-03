// 좁은 폭(720px 이하): 캔버스 대신 개요 편집기. 그룹은 caustic LayerTree(블록 → 기능·출력), 끌어 옮기면 쌓는 순서가
// 바뀐다. 흐름은 단계 목록(caustic List, 다음 단계를 설명 한 줄로). 같은 데이터, 같은 검사 결과를 글줄로 보인다.
import {
  List,
  ListRow,
  LayerTree,
  LayerTreeItem,
  type LayerTreeAnnouncement,
} from "@caustic/react";
import { CircleAlert, T } from "../../_shell";
import { helmBlocks, invalidBlocks } from "../fixtures";
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
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <LayerTree
        aria-label={`${name} ${T.block}`}
        announce={announce}
        size="sm"
        value={m.selected !== null ? [m.selected] : []}
        onValueChange={(v) => m.set({ selected: v[0] ?? null })}
        defaultExpanded={blocks.map((b) => b.id)}
      >
        {blocks.flatMap((b) => [
          <LayerTreeItem
            key={b.id}
            itemId={b.id}
            depth={0}
            {...(b.issue?.level === "error" ? { icon: <CircleAlert /> } : {})}
            label={b.title}
            expandable={b.consumes.length + b.produces.length > 0}
            open
          />,
          ...b.consumes.map((c) => (
            <LayerTreeItem
              key={`${b.id}-${c.cap}`}
              itemId={`${b.id}-${c.cap}`}
              depth={1}
              label={c.cap}
              caption={c.provider ?? "제공하는 확장 없음"}
            />
          )),
          ...b.produces.map((o) => (
            <LayerTreeItem
              key={`${b.id}-${o.id}`}
              itemId={`${b.id}-${o.id}`}
              depth={1}
              label={o.label}
            />
          )),
        ])}
      </LayerTree>
    </div>
  );
}

const STEPS: { id: string; title: string; next: string }[] = [
  { id: "idle", title: "대기", next: "→ 확산" },
  { id: "diverge", title: "확산", next: "→ 탐색 · 쓰기 거부" },
  { id: "explore", title: "탐색", next: "→ 수렴" },
  { id: "converge", title: "수렴", next: "→ 적용" },
  { id: "apply", title: "적용", next: "→ 끝" },
];

export function FlowOutline() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <List size="sm" aria-label="단계 머신">
        {STEPS.map((s) => (
          <ListRow
            key={s.id}
            title={<span className="text-body font-medium">{s.title}</span>}
            description={<span className="text-footnote text-text-tertiary">{s.next}</span>}
          />
        ))}
      </List>
    </div>
  );
}
