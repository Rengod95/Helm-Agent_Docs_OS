import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  PopoverDescription,
  PopoverTitle,
} from "@caustic/react";
import { Check, CornerUpRight, Eye, Layers } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import { useState, type ReactNode } from "react";
import { useThread, useTurnSummaries } from "../state/engine/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { useDesktopShell } from "./desktop-shell-context.ts";
import { tokenCountText, useDefaultModel, useModelNameOf, useThreadModel } from "./model-usage.ts";
import { useScheduleOrigin } from "./schedule-origin.ts";
import { scheduleOriginTextOf } from "./schedule-origin-model.ts";
import { ScreenHeader } from "./shell/screen-header.tsx";
import { ThreadRowMenu } from "./thread-row-menu.tsx";
import {
  setTranscriptDetailValue,
  TRANSCRIPT_DETAILS,
  useTranscriptDetail,
  type TranscriptDetail,
} from "./transcript-detail.ts";
import { MetaParts } from "./meta-parts.tsx";

// 대화 머리(시안 _chat-rt의 ChatHead): 고른 대화의 제목 한 줄과 오른쪽 도구(L4.desktop-ux DP-103 [결정: 2026-11-11 사용자]).
// 제목 뒤: 예약이 시작한 대화의 예약 줄, 갈라낸 대화의 "원본" 링크. 오른쪽: 생각·도구 표시 수준 메뉴, 턴별 사용량, ⋯ 메뉴(행 메뉴와 같다).
// 왼쪽 패널이 닫혀 있으면 맨 앞에 "시작 영역 열기" 단추를 둔다. 대화를 고르지 않았어도 머리 띠는 그린다(DP-122): 제목은 비고
// 플레이그라운드 탭과 아래 선이 남아 왼쪽 패널 머리의 선과 한 줄로 이어진다.
// 머리는 대화 열이 아니라 내용 영역 전체 폭이다(`.shell-header`). 높이는 `--shell-header-h`, 아래에 border-subtle 선.

export function ChatHeader(): ReactNode {
  const id = useSelectedThreadId();
  if (id === null) return <HeadRow title={null} action={null} />;
  return <ChatHeaderOf id={id} />;
}

function ChatHeaderOf(props: { readonly id: ThreadId }): ReactNode {
  const thread = useThread(props.id);
  if (thread === undefined) return <HeadRow title={null} action={null} />;
  const title = thread.title ?? t("desktop.threads.untitled");
  const origin = thread.origin;
  return (
    <HeadRow
      title={
        <>
          <h1 title={title} className="m-0 min-w-0 truncate font-medium text-text-secondary">
            {title}
          </h1>
          {/* 예약이 시작한 대화는 제목 뒤에 흐린 예약 줄을 한 줄로 붙인다 */}
          {origin?.kind === "schedule" ? (
            <ScheduleOriginLine
              key={props.id}
              threadId={props.id}
              scheduleId={origin.scheduleId}
              status={thread.status}
            />
          ) : null}
          {thread.forkedFrom === null ? null : <ForkOrigin from={thread.forkedFrom.threadId} />}
        </>
      }
      action={
        <span className="flex flex-none items-center gap-1">
          <DetailMenu />
          <UsageButton threadId={props.id} />
          <ThreadRowMenu id={props.id} title={title} status={thread.status} />
        </span>
      }
    />
  );
}

/** 예약 줄. 제목과 순번을 아직 모르면 "예약"만 보인다. 대화가 바뀌면 key로 새로 읽는다 */
function ScheduleOriginLine(props: {
  readonly threadId: ThreadId;
  readonly scheduleId: string;
  readonly status: ThreadSummary["status"];
}): ReactNode {
  const origin = useScheduleOrigin(props.scheduleId, props.threadId, props.status);
  const parts = scheduleOriginTextOf(origin.title, origin.ordinal);
  return (
    <span
      title={parts.join("\n")}
      className="flex min-w-0 items-baseline gap-2 text-ui text-text-tertiary"
    >
      <MetaParts parts={parts} className="min-w-0 truncate" />
    </span>
  );
}

/** 갈라낸 대화의 출처 링크: "↱ 원본 제목". 원본이 목록에 없으면(지워짐) 누를 수 없는 글이다 */
function ForkOrigin(props: { readonly from: ThreadId }): ReactNode {
  const commands = useCommands();
  const source = useThread(props.from);
  const name = source?.title ?? t("desktop.threads.untitled");
  const text = t("desktop.chatHeader.forkedFrom", { title: name });
  if (source === undefined) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-ui text-text-tertiary">
        <CornerUpRight aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{t("desktop.chatHeader.forkedFromGone")}</span>
      </span>
    );
  }
  return (
    <Button
      size="xs"
      variant="ghost"
      title={text}
      data-chat-fork-origin=""
      className="min-w-0 max-w-64 gap-1 font-normal text-text-tertiary"
      onClick={() => {
        commands.selectThread(props.from);
      }}
    >
      <CornerUpRight aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </Button>
  );
}

const DETAIL_LABEL_ID: Readonly<Record<TranscriptDetail, MessageId>> = {
  full: "desktop.settings.appearance.transcriptDetail.full",
  summary: "desktop.settings.appearance.transcriptDetail.summary",
  hidden: "desktop.settings.appearance.transcriptDetail.hidden",
};

const DETAIL_HINT_ID: Readonly<Record<TranscriptDetail, MessageId>> = {
  full: "desktop.chatHeader.detail.full.hint",
  summary: "desktop.chatHeader.detail.summary.hint",
  hidden: "desktop.chatHeader.detail.hidden.hint",
};

/**
 * 생각·도구 표시 수준 메뉴. 설정 "외관"의 같은 줄과 같은 로컬 값(`LOCAL.transcriptDetail`)을 쓴다. 셸이 없는 웹 미리보기는 저장하지 않고
 * 이 창에만 건다
 */
function DetailMenu(): ReactNode {
  const detail = useTranscriptDetail();
  const shell = useDesktopShell();
  const choose = (next: TranscriptDetail): void => {
    if (shell === null) {
      setTranscriptDetailValue(next);
      return;
    }
    detach(shell.appearance.setTranscriptDetail(next), rethrow);
  };
  return (
    <Menu
      size="sm"
      align="end"
      className="w-64"
      aria-label={t("desktop.settings.appearance.transcriptDetail")}
      trigger={
        <IconButton
          size="md"
          variant="ghost"
          data-chat-detail={detail}
          label={`${t("desktop.settings.appearance.transcriptDetail")}: ${t(DETAIL_LABEL_ID[detail])}`}
        >
          <Eye aria-hidden />
        </IconButton>
      }
    >
      {TRANSCRIPT_DETAILS.map((option) => (
        <MenuItem
          key={option}
          role="menuitemradio"
          selected={option === detail}
          end={option === detail ? <Check aria-hidden className="size-3.5" /> : undefined}
          onSelect={() => {
            if (option !== detail) choose(option);
          }}
        >
          <span className="grid min-w-0 gap-0.5 py-0.5 text-start">
            <span>{t(DETAIL_LABEL_ID[option])}</span>
            <span className="text-ui-sm text-text-tertiary">{t(DETAIL_HINT_ID[option])}</span>
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

const USAGE_ROWS = 8;

/** 턴 시간: 1분 미만은 초, 그 이상은 분과 초 */
export function turnDurationText(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t("desktop.chatHeader.usage.seconds", { seconds });
  return t("desktop.chatHeader.usage.minutes", {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  });
}

/** 비용: 모르면 대시, 1센트 미만은 소수 넷, 그 이상은 둘 */
export function turnCostText(cost: number | null): string {
  if (cost === null) return "—";
  return `$${cost.toFixed(cost > 0 && cost < 0.01 ? 4 : 2)}`;
}

/** 표에 보일 턴: 끝났거나 도는 턴 가운데 최근 `USAGE_ROWS`개를 대화 순서대로(오래된 것이 위, 번호는 대화 처음부터) */
export function usageRowsOf<T>(turns: readonly T[]): readonly {
  readonly index: number;
  readonly turn: T;
}[] {
  return turns.map((turn, index) => ({ index: index + 1, turn })).slice(-USAGE_ROWS);
}

/**
 * 표의 모델 칸 참조. 턴 기록의 모델은 대화가 모델을 정했을 때만 있다(`turn.started` 때의 `ThreadSummary.model`).
 * 정하지 않은 대화의 턴은 기본 모델로 돌았으므로 `fallback`(지금 대화가 쓰는 모델)을 쓴다. 둘 다 모르면 null이다
 */
export function usageModelRefOf(turnModel: string | null, fallback: string | null): string | null {
  return turnModel ?? fallback;
}

/** 이 대화의 합계(사용량을 아는 턴만) */
export function usageTotalOf(
  turns: readonly {
    readonly usage: { readonly totalTokens: number; readonly cost: number | null } | null;
  }[],
): {
  readonly tokens: number;
  readonly cost: number | null;
} {
  let tokens = 0;
  let cost: number | null = null;
  for (const turn of turns) {
    if (turn.usage === null) continue;
    tokens += turn.usage.totalTokens;
    if (turn.usage.cost !== null) cost = (cost ?? 0) + turn.usage.cost;
  }
  return { tokens, cost };
}

/** 턴별 사용량 단추. 누르면 최근 턴 표(순번, 모델, 시간, 토큰, 비용)와 합계를 연다. 턴이 없으면 그리지 않는다 */
function UsageButton(props: { readonly threadId: ThreadId }): ReactNode {
  const turns = useTurnSummaries(props.threadId);
  const [open, setOpen] = useState(false);
  const nameOf = useModelNameOf();
  const current = useThreadModel(props.threadId, useDefaultModel()).ref;
  if (turns.length === 0) return null;
  const rows = usageRowsOf(turns);
  const total = usageTotalOf(turns);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      size="lg"
      anchor={
        <IconButton size="md" variant="ghost" label={t("desktop.chatHeader.usage.button")}>
          <Layers aria-hidden />
        </IconButton>
      }
    >
      <PopoverTitle>{t("desktop.chatHeader.usage.title")}</PopoverTitle>
      <PopoverDescription>
        <span className="inline-flex min-w-0 flex-wrap items-baseline gap-2">
          <span>{t("desktop.chatHeader.usage.turns", { turns: turns.length })}</span>{" "}
          <span>
            {t("desktop.chatHeader.usage.tokens", { tokens: tokenCountText(total.tokens) })}
          </span>{" "}
          <span>{turnCostText(total.cost)}</span>
        </span>
      </PopoverDescription>
      <table className="mt-2 w-full border-collapse text-ui-sm tabular-nums">
        <thead>
          <tr className="text-text-tertiary">
            <th scope="col" className="py-1 pe-2 text-end font-normal">
              {t("desktop.chatHeader.usage.col.turn")}
            </th>
            <th scope="col" className="py-1 pe-2 text-start font-normal">
              {t("desktop.chatHeader.usage.col.model")}
            </th>
            <th scope="col" className="py-1 pe-2 text-end font-normal">
              {t("desktop.chatHeader.usage.col.time")}
            </th>
            <th scope="col" className="py-1 pe-2 text-end font-normal">
              {t("desktop.chatHeader.usage.col.tokens")}
            </th>
            <th scope="col" className="py-1 text-end font-normal">
              {t("desktop.chatHeader.usage.col.cost")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ index, turn }) => {
            const model = usageModelRefOf(turn.model, current);
            return (
              <tr key={turn.turnId} className="border-t border-border-subtle text-text-secondary">
                <td className="py-1 pe-2 text-end">{index}</td>
                <td className="max-w-40 truncate py-1 pe-2" title={model ?? undefined}>
                  {model === null ? "—" : nameOf(model)}
                </td>
                <td className="py-1 pe-2 text-end">
                  {turn.running
                    ? t("desktop.chatHeader.usage.running")
                    : turnDurationText(turn.durationMs)}
                </td>
                <td className="py-1 pe-2 text-end">
                  {turn.usage === null ? "—" : tokenCountText(turn.usage.totalTokens)}
                </td>
                <td className="py-1 text-end">{turnCostText(turn.usage?.cost ?? null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Popover>
  );
}

/** 머리 한 줄. title이 null이면 대화가 없는 머리라서, 패널이 열려 있으면 그리지 않는다 */
function HeadRow(props: { readonly title: ReactNode; readonly action: ReactNode }): ReactNode {
  return (
    // 대화 기록 스크롤 영역(VirtualList)이 안쪽 위 여백을 이미 가져서 머리에 공용 간격을 더하지 않는다
    <ScreenHeader flush title={props.title} action={props.action} />
  );
}
