// 목록 보기(700px 이하의 캔버스 대체, 머리 "목록"으로도): 띠마다 한 묶음, 블록은 Chip 같은 칸(상태 점 + 이름).
// 엣지 대신 블록 옆에 연결 요약(훅 수 · post · drive · 기능)을 글자로 둔다. 고르면 같은 검사기를 연다.
import { CircleX, Play, TriangleAlert } from "../../_shell";
import { BANDS, NODES, VIEWS, type CNode } from "../data";
import { Mark } from "./node";

function summary(n: CNode) {
  const parts: string[] = [];
  if ((n.points ?? []).length > 0) parts.push(`on ${(n.points ?? []).length}`);
  if (n.usesPost === true) parts.push("post");
  if (n.usesDrive === true) parts.push("drive");
  if ((n.provides ?? []).length > 0) parts.push(`기능 ${(n.provides ?? []).length}`);
  return parts.join(" · ");
}

export function LayerList({
  ctx,
  selected,
  onSelect,
}: {
  ctx: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const view = VIEWS[ctx] ?? VIEWS.all!;
  return (
    <div className="grid content-start gap-3 px-3 pb-6">
      {BANDS.map((b) => {
        const items = NODES.filter((n) => n.band === b.id);
        return (
          <section key={b.id} aria-labelledby={`band-${b.id}`} className="grid gap-1">
            <h2
              id={`band-${b.id}`}
              className="m-0 flex items-baseline gap-2 text-ui-dense font-semibold text-text-primary"
            >
              <span className="font-mono text-mono-sm text-text-secondary">{b.id}</span>
              {b.title}
              <span className="text-ui-xs font-normal text-text-tertiary">{items.length}</span>
            </h2>
            <ul role="list" className="m-0 grid list-none gap-0.5 p-0">
              {items.map((n) => {
                const st = view.nodes[n.id] ?? { on: true };
                const cur = selected === n.id;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      aria-pressed={cur}
                      onClick={() => onSelect(n.id)}
                      className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start text-ui-sm outline-none focus-visible:shadow-focus ${cur ? "bg-neutral-selected" : "hover:bg-neutral-hover"}`}
                    >
                      <span
                        aria-hidden
                        className={`size-1.5 flex-none rounded-full ${n.health === "auto_disabled" ? "bg-danger-graphic" : n.health === "failing" ? "bg-warning-graphic" : st.on ? "bg-neutral-graphic" : "bg-transparent"}`}
                      />
                      <span
                        className={`truncate ${st.on ? "text-text-primary" : "text-text-tertiary"}`}
                      >
                        {n.label}
                      </span>
                      {n.id !== n.label && (
                        <span className="truncate font-mono text-mono-sm text-text-tertiary">
                          {n.id}
                        </span>
                      )}
                      {st.drive === "holder" && (
                        <Mark tone="neutral">
                          <Play emphasis="selected" />
                        </Mark>
                      )}
                      {n.health === "auto_disabled" && (
                        <Mark tone="danger">
                          <CircleX />
                        </Mark>
                      )}
                      {n.health === "failing" && (
                        <Mark tone="warning" count={n.failures}>
                          <TriangleAlert />
                        </Mark>
                      )}
                      <span className="ms-auto truncate text-ui-xs text-text-tertiary">
                        {n.health === "auto_disabled"
                          ? "자동 꺼짐"
                          : st.pending === "enable"
                            ? "다음 단계 경계에 켜짐"
                            : !st.on
                              ? "꺼짐"
                              : st.drive === "waiting"
                                ? "drive 대기"
                                : summary(n)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
