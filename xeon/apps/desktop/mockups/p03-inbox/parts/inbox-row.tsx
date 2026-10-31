// caustic 빈틈 C-02(알림함): 종류·출처·원인 대화·읽음 상태를 한 행에 담는 받은 요청 행이 없다.
// 공용 NoticeList(_shell/parts/notice-list.tsx)와 같은 치수(lg 모서리, px-2.5 py-2, fill-hover)로 두 줄 행을 만든다.
//   1줄: 종류 · 요약(명령이면 mono)          끝: 시각
//   2줄: 원인 대화 · 낸 그룹/확장 · caller  (연한 글자, 간격으로만 나눔)
// 종류는 아이콘 색 하나로만 말한다(DP-03: 상자·선 없음). 안 읽은 알림은 제목 굵기 하나로만.
import type { ReactNode } from "react";

export interface InboxRowProps {
  icon: ReactNode;
  /** 아이콘 색 클래스(text-*-graphic 또는 text-text-tertiary) */
  iconTone: string;
  kind: string;
  summary: ReactNode;
  mono?: boolean;
  meta: (string | undefined)[];
  at: string;
  unread?: boolean;
  /** 보낸 응답이 실패했을 때 행 아래 한 줄(danger) */
  error?: string | undefined;
  onClick?: () => void;
}

export function InboxRow({
  icon,
  iconTone,
  kind,
  summary,
  mono = false,
  meta,
  at,
  unread = false,
  error,
  onClick,
}: InboxRowProps) {
  const metaText = meta.filter((x): x is string => x !== undefined && x !== "");
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-control hover:bg-fill-hover focus-visible:focus-ring"
      >
        <span aria-hidden className={`mt-px inline-flex shrink-0 [&_svg]:size-icon-sm ${iconTone}`}>
          {icon}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-ui-sm text-text-secondary">
              {kind}
              {unread && <span className="sr-only">, 안 읽음</span>}
            </span>
            <span
              className={[
                "min-w-0 truncate text-text-primary",
                mono ? "font-mono text-mono-sm" : "text-ui-sm",
                unread ? "font-semibold" : "",
              ].join(" ")}
            >
              {summary}
            </span>
          </span>
          {metaText.length > 0 && (
            <span className="flex min-w-0 gap-2.5 truncate text-ui-xs text-text-tertiary">
              {metaText.map((t) => (
                <span key={t} className="truncate">
                  {t}
                </span>
              ))}
            </span>
          )}
          {error !== undefined && (
            <span role="alert" className="text-ui-xs text-danger-text">
              {error}
            </span>
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap text-ui-xs tabular-nums text-text-tertiary">
          {at}
        </span>
      </button>
    </li>
  );
}
