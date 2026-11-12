import { ChevronRight } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ItemId, ThreadId } from "@fresnel/contracts/conversation";
import type { ReactNode } from "react";
import { HeightGlide, SwapFade } from "../../lib/motion-presets.tsx";
import { useItem, useToolResults } from "../../state/engine/index.ts";
import { useTranscriptDetail } from "../transcript-detail.ts";
import type { ActivityEntry } from "../transcript-rows.ts";
import { activitySummaryOf, type ActivityCall } from "./activity-model.ts";
import { ThinkingBlock } from "./thinking-block.tsx";
import { CallChip } from "../call-chip.tsx";
import { CallRow, resultViewOf, useCallRunning, useElapsedSeconds } from "./tool-call-row.tsx";
import { Reveal, useDisclosure } from "./tool-line.tsx";
import { toolHeadOf } from "./tool-view-model.ts";

// 활동 묶음(dzT2a 시안 6절). 같은 턴에서 글 없이 이어진 도구 호출을 한 머리로 접는다.
// 도는 동안은 현재형 머리와 지금 도는 줄이 보이고, 끝나면 접힌다. 접혀도 실패·거부·개입이 있는 줄은 머리 아래에 그대로 나온다.
// 호출이 하나뿐인 묶음은 머리 없이 그 줄만 그린다.
// 움직임(dzM2 시안 §4): 도는 동안 머리의 "지금 도구" 글은 교차 전환, 끝나 접힌 몸이 줄어들면 높이가 이어져 요약 한 줄로 모인다.

function ThinkingEntry(props: { readonly itemId: ItemId; readonly index: number }): ReactNode {
  const item = useItem(props.itemId);
  if (item?.kind !== "assistant") return null;
  const block = item.message.content[props.index];
  return block?.type === "thinking" ? <ThinkingBlock text={block.thinking} /> : null;
}

function EntryRow(props: {
  readonly threadId: ThreadId;
  readonly entry: ActivityEntry;
  readonly flaggedOnly: boolean;
}): ReactNode {
  const { entry } = props;
  if (entry.block.kind === "thinking") {
    return props.flaggedOnly ? null : (
      <ThinkingEntry itemId={entry.itemId} index={entry.block.index} />
    );
  }
  return (
    <CallRow
      threadId={props.threadId}
      itemId={entry.itemId}
      callId={entry.block.callId}
      name={entry.block.name}
      args={entry.block.args}
      flaggedOnly={props.flaggedOnly}
    />
  );
}

export function ActivityGroup(props: {
  readonly threadId: ThreadId;
  readonly entries: readonly ActivityEntry[];
}): ReactNode {
  const calls = props.entries.flatMap((entry) =>
    entry.block.kind === "call" ? [entry.block] : [],
  );
  const results = useToolResults(calls.map((call) => call.callId));
  const running = useCallRunning();
  const detailSetting = useTranscriptDetail();
  const pending = results.filter((r) => r === undefined).length;
  const live = running && pending > 0;
  const seconds = useElapsedSeconds(live);
  // 끝난 묶음은 접는다. 도는 동안에도 머리 아래에는 도는 줄과 표시할 줄이 늘 보인다
  const [open, toggle] = useDisclosure(false);
  const only = calls[0];
  const first = props.entries[0];
  if (
    calls.length === 1 &&
    only !== undefined &&
    first !== undefined &&
    props.entries.length === 1
  ) {
    // 쓰는 중이던 호출 줄이 확정되어 이 줄이 될 때 그 줄의 높이(인자 꼬리 포함)에서 이어 준다(dzM2 시안 §4)
    return (
      <HeightGlide handoff={first.itemId}>
        <CallRow
          threadId={props.threadId}
          itemId={first.itemId}
          callId={only.callId}
          name={only.name}
          args={only.args}
        />
      </HeightGlide>
    );
  }
  const activity: ActivityCall[] = calls.map((call, index) => ({
    name: call.name,
    args: call.args,
    server: resultViewOf(results[index])?.server ?? null,
  }));
  const failed = results.filter((r) => resultViewOf(r)?.outcome.kind === "failed").length;
  // 표시 "숨김": 성공만 있는 끝난 묶음은 머리도 그리지 않고, 표시할 줄만 남긴다
  const hideHead = detailSetting === "hidden" && !live;
  const current = live ? calls.findLast((_, index) => results[index] === undefined) : undefined;
  const summary =
    live && current !== undefined
      ? t("desktop.convo.group.live", {
          verb: toolHeadOf(current.name, current.args, null).verbRunning,
          count: calls.length,
        })
      : activitySummaryOf(activity);
  const body = (flaggedOnly: boolean): ReactNode =>
    props.entries.map((entry) => (
      <EntryRow
        key={
          entry.block.kind === "call" ? entry.block.callId : `${entry.itemId}:${entry.block.index}`
        }
        threadId={props.threadId}
        entry={entry}
        flaggedOnly={flaggedOnly}
      />
    ));
  if (hideHead) return <div className="grid min-w-0">{body(true)}</div>;
  return (
    <div className="grid min-w-0" data-slot="convo-activity">
      <div className="convo-line" data-toggle="true" data-open={open ? "true" : undefined}>
        <button
          type="button"
          className="convo-line-hit"
          aria-expanded={open}
          aria-label={summary}
          onClick={toggle}
        />
        <ChevronRight
          aria-hidden
          className={
            open
              ? "convo-line-icon rotate-90 transition-transform duration-quick"
              : "convo-line-icon transition-transform duration-quick"
          }
        />
        <span className="convo-line-verb relative min-w-0 truncate">
          {/* 도는 동안만 바뀌는 글이 교차 전환된다. 끝난 묶음은 글이 한 번 바뀌고 멈춘다 */}
          <SwapFade swapKey={summary} inline>
            {summary}
          </SwapFade>
        </span>
        <span className="convo-line-meta">
          {live && seconds > 0
            ? t("desktop.convo.group.metaLive", { count: calls.length, seconds })
            : failed > 0
              ? t("desktop.convo.group.metaFailed", { count: calls.length, failed })
              : t("desktop.convo.group.meta", { count: calls.length })}
        </span>
        <span className="convo-line-status">{live ? <CallChip status="running" /> : null}</span>
      </div>
      <HeightGlide>
        {open ? null : <div className="convo-group-body empty:hidden">{body(true)}</div>}
      </HeightGlide>
      <Reveal open={open}>
        <div className="convo-group-body">{body(false)}</div>
      </Reveal>
    </div>
  );
}
