// caustic 빈틈 C-02(알림함): 읽음 상태, 종류 표시, 원인 링크를 갖춘 알림 목록 부품이 없다.
// 행 하나는 버튼(누르면 원인 대화나 화면으로)이고, 종류는 상태 점(danger = 안 읽은 오류)과 아이콘, 시각은 끝에 둔다.
// 바탕·모서리·hover는 caustic 토큰(surface-base, border-subtle 헤어라인, xl 모서리 안 lg 행, fill-hover)만 쓴다.
import type { Notice } from "../fixtures";
import { CircleAlert, CircleCheck, Sparkles } from "../icons";

const KIND = {
  error: { icon: <CircleAlert />, tone: "text-danger-graphic", word: "오류" },
  completed: { icon: <CircleCheck />, tone: "text-success-graphic", word: "완료" },
  background_completed: { icon: <Sparkles />, tone: "text-text-tertiary", word: "백그라운드" },
} as const;

export function NoticeList({ notices }: { notices: Notice[] }) {
  return (
    <ul className="m-0 grid list-none gap-0.5 rounded-xl bg-surface-base p-1 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
      {notices.map((n) => {
        const k = KIND[n.kind];
        const unread = n.kind === "error";
        return (
          <li key={n.title}>
            <button
              type="button"
              className="flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-control hover:bg-fill-hover focus-visible:focus-ring"
            >
              <span
                aria-hidden
                className={`mt-px inline-flex shrink-0 [&_svg]:size-icon-sm ${k.tone}`}
              >
                {k.icon}
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-ui-sm text-text-primary">
                  <span className="sr-only">
                    {k.word}
                    {unread ? ", 안 읽음" : ""}:{" "}
                  </span>
                  <span className={unread ? "font-semibold" : undefined}>{n.title}</span>
                </span>
                {n.body !== undefined && (
                  <span className="truncate font-mono text-mono-sm text-text-secondary">
                    {n.body}
                  </span>
                )}
              </span>
              <span className="shrink-0 whitespace-nowrap text-ui-xs tabular-nums text-text-tertiary">
                {n.at}
              </span>
              {unread && (
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-solid"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
