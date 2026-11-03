// 플러그인 코드 흉내: taskflow/board 프레임 안 문서(목업에서는 같은 React 트리지만, 실제로는 sandbox iframe 안 플러그인 HTML·JS).
// 플러그인은 셸이 보낸 caustic 토큰(push "theme")으로 모양을 맞춘다(ADR-0021 §3.6.8). 그래서 토큰 색은 쓰되 caustic 부품은 쓰지 않는다
// (프레임 안 caustic 배포물은 미결 10). 일부러 앱 화면과 조금 다른 손맛(둥근 카드, 자체 단추)으로 그려 "앱 화면이 아님"을 보인다.
// 판 위 작은 의존 그래프(SVG)와 끌어 옮기기가 기본 부품으로 못 그리는 이유다(frame.reason).
import type { Task, TaskCol } from "../data";
import { colLabel } from "../data";

const COLS: TaskCol[] = ["todo", "doing", "done"];

/** 의존 그래프(고정 좌표). 노드 = 작업, 선 = after. */
const NODES: Record<string, { x: number; y: number }> = {
  t10: { x: 40, y: 22 },
  t11: { x: 40, y: 62 },
  t12: { x: 170, y: 42 },
  t13: { x: 300, y: 22 },
  t14: { x: 300, y: 62 },
  t15: { x: 430, y: 42 },
};
const EDGES: [string, string][] = [
  ["t10", "t12"],
  ["t11", "t12"],
  ["t12", "t13"],
  ["t12", "t14"],
];

function Graph({ tasks, focus }: { tasks: Task[]; focus: string | null }) {
  const colOf = (id: string) => tasks.find((t) => t.id === id)?.col ?? "todo";
  return (
    <svg
      viewBox="0 0 480 84"
      role="img"
      aria-label="작업 의존 그래프"
      className="h-[84px] w-full max-w-[34rem]"
    >
      {EDGES.map(([a, b]) => {
        const p = NODES[a];
        const q = NODES[b];
        if (p === undefined || q === undefined) return null;
        const mx = (p.x + q.x) / 2;
        return (
          <path
            key={`${a}-${b}`}
            d={`M${p.x + 22} ${p.y} C${mx} ${p.y}, ${mx} ${q.y}, ${q.x - 22} ${q.y}`}
            fill="none"
            stroke="var(--cs-color-border-strong)"
            strokeWidth={1.25}
          />
        );
      })}
      {Object.entries(NODES).map(([id, n]) => {
        const col = colOf(id);
        return (
          <g key={id}>
            <rect
              x={n.x - 22}
              y={n.y - 11}
              width={44}
              height={22}
              rx={11}
              fill={
                col === "done"
                  ? "var(--cs-color-bg-inset)"
                  : col === "doing"
                    ? "var(--cs-color-agent-soft)"
                    : "var(--cs-color-surface-raised)"
              }
              stroke={
                focus === id ? "var(--cs-color-text-primary)" : "var(--cs-color-border-default)"
              }
              strokeWidth={focus === id ? 1.5 : 1}
            />
            <text
              x={n.x}
              y={n.y + 4}
              textAnchor="middle"
              fontSize={11}
              fontFamily="var(--cs-font-mono)"
              fill={
                col === "done" ? "var(--cs-color-text-tertiary)" : "var(--cs-color-text-primary)"
              }
            >
              {id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface BoardProps {
  tasks: Task[];
  /** 막 옮긴 작업(그래프에서 테두리) */
  focus: string | null;
  dispatch: "idle" | "waiting" | "done" | "denied";
  /** 오프라인이면 프레임은 push "host"로 알고 스스로 단추를 잠근다 */
  offline?: boolean;
  onMove: (id: string) => void;
  onDispatch: () => void;
  onLink: () => void;
}

export function FrameBoard({
  tasks,
  focus,
  dispatch,
  offline = false,
  onMove,
  onDispatch,
  onLink,
}: BoardProps) {
  const todo = tasks.filter((t) => t.col === "todo").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-ui-sm font-semibold text-text-primary">캐시 무효화 조사</span>
        <span className="text-ui-xs text-text-tertiary">
          작업 {tasks.length} · 대기 {todo}
        </span>
        <button
          type="button"
          onClick={onLink}
          className="text-ui-xs text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          이슈 #412
        </button>
        <span className="ms-auto inline-flex items-center gap-2">
          {dispatch === "waiting" && (
            <span className="text-ui-xs text-text-tertiary">승인 기다리는 중…</span>
          )}
          {dispatch === "done" && (
            <span className="text-ui-xs text-text-secondary">보조 에이전트 3명에게 맡겼어요</span>
          )}
          {dispatch === "denied" && (
            <span className="text-ui-xs text-text-tertiary">맡기기를 거부했어요</span>
          )}
          <button
            type="button"
            disabled={offline || dispatch === "waiting" || dispatch === "done"}
            onClick={onDispatch}
            className="h-7 rounded-full bg-neutral-solid px-3 text-ui-xs font-medium text-neutral-on disabled:opacity-40"
          >
            대기 작업 맡기기
          </button>
        </span>
      </div>

      <Graph tasks={tasks} focus={focus} />

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
        {COLS.map((c) => (
          <div key={c} className="grid content-start gap-2 rounded-2xl bg-bg-inset p-2">
            <div className="flex items-baseline justify-between px-1">
              <span className="text-ui-xs font-semibold text-text-secondary">{colLabel[c]}</span>
              <span className="text-ui-xs tabular-nums text-text-tertiary">
                {tasks.filter((t) => t.col === c).length}
              </span>
            </div>
            {tasks
              .filter((t) => t.col === c)
              .map((t) => (
                <div
                  key={t.id}
                  className={`grid gap-1 rounded-xl bg-surface-raised p-2.5 shadow-1 ${
                    focus === t.id ? "ring-1 ring-text-primary" : ""
                  }`}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-mono-sm text-text-tertiary">{t.id}</span>
                    <span className="min-w-0 flex-1 text-ui-dense text-text-primary">
                      {t.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-ui-xs text-text-tertiary">
                    {t.after !== undefined && <span>{t.after} 다음</span>}
                    {t.who !== undefined && <span>{t.who}</span>}
                    {c === "todo" && (
                      <button
                        type="button"
                        disabled={offline}
                        onClick={() => onMove(t.id)}
                        className="ms-auto rounded-full px-2 py-0.5 text-text-secondary hover:bg-fill-hover disabled:opacity-40"
                        aria-label={`${t.id} 진행으로 옮기기`}
                      >
                        진행으로 →
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** acme-notes/map 프레임 안 문서 흉내: 노트를 자유 배치한 지도(프로젝트 확장). 셸은 이 안을 모른다. */
const NOTES = [
  { id: "n1", x: 90, y: 70, title: "TTL 경계", size: 3 },
  { id: "n2", x: 260, y: 130, title: "만료 비교 단위", size: 4 },
  { id: "n3", x: 420, y: 60, title: "무효화 이벤트", size: 2 },
  { id: "n4", x: 560, y: 170, title: "캐시 키 해시", size: 2 },
  { id: "n5", x: 170, y: 220, title: "재현 테스트", size: 3 },
];
const LINKS: [string, string][] = [
  ["n1", "n2"],
  ["n2", "n3"],
  ["n2", "n5"],
  ["n3", "n4"],
];

export function FrameMap() {
  const at = (id: string) => NOTES.find((n) => n.id === id);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      <div className="flex items-baseline gap-3">
        <span className="text-ui-sm font-semibold text-text-primary">노트 5개</span>
        <span className="text-ui-xs text-text-tertiary">끌어서 옮기면 저장돼요</span>
      </div>
      <svg viewBox="0 0 680 280" role="img" aria-label="노트 지도" className="w-full max-w-[52rem]">
        {LINKS.map(([a, b]) => {
          const p = at(a);
          const q = at(b);
          if (p === undefined || q === undefined) return null;
          return (
            <line
              key={`${a}-${b}`}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke="var(--cs-color-border-strong)"
              strokeDasharray="3 4"
            />
          );
        })}
        {NOTES.map((n) => (
          <g key={n.id}>
            <circle
              cx={n.x}
              cy={n.y}
              r={10 + n.size * 4}
              fill="var(--cs-color-agent-soft)"
              stroke="var(--cs-color-border-default)"
            />
            <text
              x={n.x}
              y={n.y + 10 + n.size * 4 + 14}
              textAnchor="middle"
              fontSize={12}
              fill="var(--cs-color-text-secondary)"
            >
              {n.title}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
