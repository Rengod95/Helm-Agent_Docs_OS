// d03(묶음 D): 시크릿 사용 기록(W-13 secret.usage). 언제, 어느 대화·도구가, 어떤 모습(ENV·헤더)으로 썼는지. 값은 없다.
// 행 사이 선 없이 간격으로(DP-26), 숫자·시각은 tabular, 기계 이름은 mono tertiary(DP-39).
import { Badge } from "@caustic/react";

const ROWS = [
  {
    at: "14:05",
    thread: "캐시 무효화 조사",
    tool: "bash",
    how: "ENV GH_TOKEN",
    ok: true,
  },
  {
    at: "13:41",
    thread: "빌드 실패 분석",
    tool: "web.fetch",
    how: "헤더 Authorization",
    ok: true,
  },
  {
    at: "11:02",
    thread: "예약: 매일 정리",
    tool: "bash",
    how: "ENV GH_TOKEN",
    ok: false,
  },
  {
    at: "어제 18:20",
    thread: "렌즈 5개로 넓히기",
    tool: "bash",
    how: "ENV GH_TOKEN",
    ok: true,
  },
];

export function UsageLog({ name }: { name: string }) {
  return (
    <section aria-label={`${name} 사용 기록`} className="grid gap-1">
      <h3 className="m-0 flex h-7 items-center gap-2 text-ui-sm font-semibold text-text-secondary">
        사용 기록
        <span className="font-normal text-text-tertiary">최근 7일</span>
      </h3>
      <div role="table" aria-label="사용 기록" className="grid gap-0.5 text-ui-sm">
        {ROWS.map((r) => (
          <div
            role="row"
            key={r.at + r.thread}
            className="grid grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-baseline gap-3 py-1"
          >
            <span role="cell" className="tabular-nums text-text-tertiary">
              {r.at}
            </span>
            <span role="cell" className="min-w-0 truncate text-text-primary">
              {r.thread} <span className="font-mono text-mono-sm text-text-tertiary">{r.tool}</span>
            </span>
            <span role="cell" className="min-w-0 truncate text-text-secondary">
              {r.how}
            </span>
            <span role="cell">
              {r.ok ? (
                <span className="text-ui-xs text-text-tertiary">썼어요</span>
              ) : (
                <Badge size="xs" tone="danger">
                  거절
                </Badge>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
