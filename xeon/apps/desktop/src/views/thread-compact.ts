import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { WIRE_ERRORS, type WireResult } from "@fresnel/contracts/wire";
import { toast } from "@caustic/react";
import type { CommandError, Commands } from "./commands.ts";
import { bumpUsageEpoch } from "./model-usage.ts";

// "대화 요약"(`thread.compact`)의 진행 표시와 결과 한 줄. 메뉴와 팔레트가 같이 쓴다.
// 눌렀을 때 진행 토스트를 띄우고, 끝나면 결과(엔진이 준 `tokensBefore`, 요약할 것이 없는 이유)나 실패 이유를 한 줄로 바꾼다.

export interface CompactNotice {
  readonly tone: "success" | "info" | "danger";
  readonly id: MessageId;
  readonly args?: Readonly<Record<string, string | number>>;
}

const COMPACT_FAILED = WIRE_ERRORS["thread.compactFailed"].code;
const TURN_BUSY = WIRE_ERRORS["turn.busy"].code;
const THREAD_CLOSED = WIRE_ERRORS["thread.closed"].code;
const CANCELLED = WIRE_ERRORS["thread.cancelledByExtension"].code;

/** 엔진이 준 결과나 실패를 사용자에게 보일 한 줄로 */
export function compactNoticeOf(
  result: Result<WireResult<"thread.compact">, CommandError>,
  keepTokens: number | null = null,
): CompactNotice {
  if (result.ok) {
    const { value } = result;
    if (value.status === "compacted") {
      // 요약 뒤가 앞보다 크거나 같으면 줄었다고 말하지 않는다(앞 요약이 길 때)
      if (value.tokensAfter >= value.tokensBefore) {
        return {
          tone: "info",
          id: "desktop.threads.compact.done.same",
          args: { after: value.tokensAfter },
        };
      }
      return {
        tone: "success",
        id: "desktop.threads.compact.done",
        args: { before: value.tokensBefore, after: value.tokensAfter },
      };
    }
    if (value.why === "disabled") {
      return { tone: "info", id: "desktop.threads.compact.skipped.disabled" };
    }
    if (value.why === "last_entry_is_compaction") {
      return { tone: "info", id: "desktop.threads.compact.skipped.already" };
    }
    // 문턱을 알면 함께 말한다(요약하지 않고 그대로 두는 최근 토큰 수보다 적게 쌓인 대화는 요약할 것이 없다)
    if (keepTokens !== null) {
      return {
        tone: "info",
        id: "desktop.threads.compact.skipped.threshold",
        args: { tokens: keepTokens },
      };
    }
    return { tone: "info", id: "desktop.threads.compact.skipped.nothing" };
  }
  const { error } = result;
  if (error.kind === "offline")
    return { tone: "danger", id: "desktop.threads.menu.failed.offline" };
  if (error.kind === "rejected") {
    if (error.code === COMPACT_FAILED)
      return { tone: "danger", id: "desktop.threads.compact.failed.summary" };
    if (error.code === TURN_BUSY)
      return { tone: "danger", id: "desktop.threads.compact.failed.busy" };
    if (error.code === THREAD_CLOSED)
      return { tone: "danger", id: "desktop.threads.compact.failed.closed" };
    if (error.code === CANCELLED)
      return { tone: "danger", id: "desktop.threads.compact.failed.cancelled" };
  }
  return { tone: "danger", id: "desktop.threads.compact.failed" };
}

/** 진행 토스트를 띄우고 요약을 보낸 뒤 결과 토스트로 바꾼다. 실패 토스트는 자동으로 닫히지 않는다 */
export function runThreadCompact(
  commands: Pick<Commands, "compactThread" | "compactKeepTokens">,
  threadId: ThreadId,
  instructions?: string,
): void {
  const progress = toast({
    tone: "info",
    title: t("desktop.threads.compact.running"),
    duration: 0,
  });
  detach(
    commands.compactThread(threadId, instructions).then(async (result) => {
      const nothing =
        result.ok &&
        result.value.status === "skipped" &&
        result.value.why === "nothing_to_summarize";
      const keepTokens = nothing ? await commands.compactKeepTokens() : null;
      toast.dismiss(progress);
      // 요약 직후 상태 줄 문맥 크기를 요약 뒤 값으로 다시 읽게 한다
      if (result.ok && result.value.status === "compacted") bumpUsageEpoch();
      const notice = compactNoticeOf(result, keepTokens);
      toast({
        tone: notice.tone,
        title: t(notice.id, notice.args),
        ...(notice.tone === "danger"
          ? { duration: 0, dismissLabel: t("desktop.threads.compact.dismiss") }
          : {}),
      });
      return undefined;
    }),
    rethrow,
  );
}
