// Helm 렌즈 트리(ADR-0021 위젯 ActivityTree, DP-24: 렌즈 = 자식 에이전트, 펼치면 그 렌즈의 도구 호출 행).
// caustic 빈틈: ActivityTree에 단계(step)를 접고 펴는 기능이 없다. 렌즈 행(펼치기 버튼)을 ActivityTree 단계 행 모양으로 그리고,
// 펼친 렌즈의 도구 호출만 ActivityTree(variant ghost, 호출 노드)로 그린다. 실행 중 렌즈는 worker 줄로 "지금 하는 일"을 보인다.
import { ActivityTree, type ActivityNode } from "@caustic/react";
import { useId, useState } from "react";
import { ChevronRight, CircleAlert, CircleCheck, type Lens } from "../../_shell";

const statusText: Record<Lens["status"], string> = {
  running: "실행 중",
  done: "완료",
  failed: "실패",
};

function LensRow({
  lens,
  open,
  onToggle,
  bodyId,
}: {
  lens: Lens;
  open: boolean;
  onToggle: () => void;
  bodyId: string;
}) {
  const meta =
    lens.status === "done" && lens.findings !== undefined
      ? `완료 · 발견 ${lens.findings}`
      : statusText[lens.status];
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? bodyId : undefined}
      onClick={onToggle}
      className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1 text-start text-ui-dense outline-none hover:bg-neutral-hover focus-visible:focus-ring"
    >
      <ChevronRight
        aria-hidden
        className={`size-icon-xs flex-none text-text-tertiary transition-transform duration-quick ${open ? "rotate-90" : ""}`}
      />
      {lens.status === "running" ? (
        <span aria-hidden className="orb orb-dot size-2 flex-none rounded-full" />
      ) : lens.status === "failed" ? (
        <CircleAlert aria-hidden className="size-icon-sm flex-none text-danger-text" />
      ) : (
        <CircleCheck aria-hidden className="size-icon-sm flex-none text-text-tertiary" />
      )}
      <span
        className={`truncate ${lens.status === "running" ? "font-medium text-text-primary" : "text-text-primary"}`}
      >
        {lens.title}
      </span>
      <span className="truncate font-mono text-mono-sm text-text-tertiary">lens:{lens.id}</span>
      <span
        className={`ms-auto flex-none text-ui-xs tabular-nums ${lens.status === "failed" ? "text-danger-text" : "text-text-tertiary"}`}
      >
        {meta}
      </span>
    </button>
  );
}

export function LensTree({ lenses, defaultOpen = [] }: { lenses: Lens[]; defaultOpen?: string[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set(defaultOpen));
  const base = useId();
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <ul aria-label="렌즈" className="m-0 grid list-none gap-0.5 p-0">
      {lenses.map((l) => {
        const isOpen = open.has(l.id);
        const bodyId = `${base}-${l.id}`;
        const nodes: ActivityNode[] = l.tools.map((t, i) => ({
          id: `${l.id}-${i}`,
          kind: "call",
          label: `${t.name} · ${t.detail}`,
          meta: t.status === "done" ? "완료" : t.status === "failed" ? "실패" : "실행 중",
          ...(t.status === "running" ? { running: true } : {}),
          ...(t.status === "failed" ? { failed: true } : {}),
        }));
        return (
          <li key={l.id}>
            <LensRow lens={l} open={isOpen} onToggle={() => toggle(l.id)} bodyId={bodyId} />
            {isOpen && (
              <div id={bodyId} className="ps-5">
                {nodes.length === 0 ? (
                  <p className="m-0 py-1 ps-2 text-ui-xs text-text-tertiary">
                    도구를 부르기 전에 멈췄어요 · 모델 응답 시간 초과
                  </p>
                ) : (
                  <ActivityTree
                    variant="ghost"
                    size="sm"
                    aria-label={`${l.title} 렌즈 도구 호출`}
                    failedLabel="실패"
                    nodes={nodes}
                    {...(l.status === "running"
                      ? { worker: { name: `${l.title} 렌즈`, meta: "결과 읽는 중" } }
                      : {})}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
