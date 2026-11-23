import { Button, EmptyState, IconButton, Menu, MenuItem } from "@caustic/react";
import { Check, ChevronDown, Maximize2, X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useOpenThread, useOpenThreadId, useThreadSummaries } from "../../state/engine/index.ts";
import { ChatBody } from "../chat-body.tsx";
import { useCommands } from "../commands.ts";
import { useShowChat } from "./plugin-view.tsx";

/** 대화 바꾸기 메뉴에 보이는 최근 대화 수 */
const MENU_THREADS = 12;

/**
 * 앱 옆 대화 열이 처음 열 대화. 열린 대화가 있으면 undefined, 없으면 목록 첫 대화(최근 활동 먼저)의 id다.
 * 목록이 비었으면 undefined다.
 */
export function recentThreadOf<T extends string>(
  openId: string | null,
  summaries: readonly { readonly id: T }[],
): T | undefined {
  if (openId !== null) return undefined;
  return summaries[0]?.id;
}

/** 제목 칸이 비었으면 "새 대화" 글 */
function titleOf(title: string | null | undefined): string {
  if (title === undefined || title === null || title.trim() === "") {
    return t("desktop.apps.chat.untitled");
  }
  return title;
}

/**
 * 앱 작업 공간의 오른쪽 대화 열. 머리 줄: 대화 바꾸기(최근 대화 목록), 크게 보기(대화 화면으로), 닫기.
 * 본문은 대화 본문(`ChatBody`)이다. 대화가 하나도 없으면 빈 상태를 그린다.
 * 처음 그릴 때 열린 대화가 없으면 목록 첫 대화를 연다(목록이 아직 비었으면 채워질 때 다시 본다).
 */
export function AppChatColumn(props: { readonly onClose: () => void }): ReactNode {
  const openId = useOpenThreadId();
  const open = useOpenThread();
  const summaries = useThreadSummaries();
  const commands = useCommands();
  const showChat = useShowChat();
  // 처음 열은 한 번만 한다. 사용자가 나중에 대화를 비워도 다시 열지 않는다
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    if (openId !== null) {
      autoOpened.current = true;
      return;
    }
    const first = recentThreadOf(
      openId,
      summaries.map((summary) => ({ id: summary.threadId })),
    );
    if (first === undefined) return;
    autoOpened.current = true;
    commands.selectThread(first);
  }, [commands, openId, summaries]);

  return (
    <aside
      aria-label={t("desktop.apps.chat.toggle")}
      className="flex min-h-0 w-2/5 min-w-88 max-w-184 flex-none flex-col border-s border-border-subtle pe-[var(--shell-rail,0px)]"
    >
      <div className="flex min-h-11 flex-none items-center gap-1 px-3">
        <Menu
          size="sm"
          align="start"
          className="w-64"
          trigger={
            <Button
              size="sm"
              variant="ghost"
              className="min-w-0"
              aria-label={t("desktop.apps.chat.switch")}
              iconEnd={<ChevronDown aria-hidden />}
            >
              <span className="min-w-0 truncate">{titleOf(open?.title)}</span>
            </Button>
          }
        >
          {summaries.slice(0, MENU_THREADS).map((summary) => {
            const current = summary.threadId === openId;
            return (
              <MenuItem
                key={summary.threadId}
                role="menuitemradio"
                selected={current}
                end={current ? <Check aria-hidden className="size-3.5" /> : undefined}
                onSelect={() => {
                  if (!current) commands.selectThread(summary.threadId);
                }}
              >
                {titleOf(summary.title)}
              </MenuItem>
            );
          })}
        </Menu>
        <div className="ms-auto flex flex-none items-center gap-1">
          <IconButton
            size="sm"
            variant="ghost"
            label={t("desktop.apps.chat.expand")}
            onClick={() => {
              showChat();
            }}
          >
            <Maximize2 aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            variant="ghost"
            label={t("desktop.apps.chat.close")}
            onClick={() => {
              props.onClose();
            }}
          >
            <X aria-hidden />
          </IconButton>
        </div>
      </div>
      {summaries.length === 0 ? (
        <EmptyState size="sm" surface="none" title={t("desktop.apps.chat.none")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatBody />
        </div>
      )}
    </aside>
  );
}
