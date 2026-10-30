// 작업대 오른쪽 "기록" 탭(§4.9.4): 맥락 대화의 런타임 이벤트(scope.changed, scope.handler_failed, lease.*) 실시간 목록.
// 행: 시각(mono, tabular) · kind · 출처(DP-33 tertiary) / 요약. 실패·꺼짐만 tone 아이콘 면(DP-29), 나머지는 muted 아이콘.
// 선 없이 간격으로 묶는다(DP-03). well 안이라 카드를 더하지 않는다(DP-20).
import { CircleAlert, CircleDot, TriangleAlert } from "../icons";
import { useShell } from "../state";
import { threads } from "../fixtures";
import { runtimeEvents, type RuntimeEvent } from "../workbench-fixtures";
import { ToneIcon } from "./tone-icon";

function Row({ e }: { e: RuntimeEvent }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 py-1">
      {e.tone === undefined ? (
        <span
          aria-hidden
          className="inline-grid size-5 place-items-center text-text-tertiary [&_svg]:size-icon-xs"
        >
          <CircleDot emphasis="muted" />
        </span>
      ) : (
        <ToneIcon tone={e.tone}>
          {e.tone === "danger" ? <CircleAlert /> : <TriangleAlert />}
        </ToneIcon>
      )}
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-ui-sm font-medium text-text-primary">{e.kind}</span>
          <span className="ms-auto flex-none font-mono text-mono-sm tabular-nums text-text-tertiary">
            {e.at}
          </span>
        </div>
        <div className="flex min-w-0 items-baseline gap-2 text-ui-xs">
          <span className="truncate text-text-secondary">{e.text}</span>
          <span className="ms-auto flex-none text-text-tertiary">{e.source}</span>
        </div>
      </div>
    </li>
  );
}

export function RuntimeLog({ events = runtimeEvents }: { events?: RuntimeEvent[] }) {
  const m = useShell();
  const title = threads.find((t) => t.id === m.contextThreadId)?.title;
  return (
    <div className="grid gap-2">
      {/* DP-21: 머리에는 "기록"만, 맥락은 본문 첫 줄 한 줄 말줄임. */}
      <p className="m-0 truncate text-ui-xs text-text-tertiary">
        {title === undefined ? "모든 대화" : title} · 실시간
      </p>
      <ol aria-label="런타임 기록" className="m-0 grid list-none p-0">
        {events.map((e) => (
          <Row key={`${e.at}-${e.kind}`} e={e} />
        ))}
      </ol>
    </div>
  );
}
