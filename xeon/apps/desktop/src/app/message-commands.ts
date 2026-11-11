import { err, ok, type Result } from "@fresnel/contracts";
import type { ItemId, ItemRecord, ThreadId } from "@fresnel/contracts/conversation";
import { WIRE_ERRORS, type HostConnection } from "@fresnel/contracts/wire";
import {
  messageCopyText,
  selectThread,
  type EngineMirror,
  type EngineStore,
} from "../state/engine/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { CommandError } from "../views/commands.ts";

// 대화 메시지 단위 동작(갈라내기, 되감기, 다시 만들기)이 부르는 wire. 기대한 실패(도는 턴, 대상이 맞지 않음)는 값이고,
// 연결과 host 실패만 `CommandError`로 돌려준다. 모든 쓰기는 쓰기 연결을 거쳐 엔진 대상을 바꾸는 중이면 `switching`으로 거절된다.
// 되감기(`thread.revert`)는 대화의 leaf만 옮긴다. 파일 변경은 되돌리지 않는다(persistence spec §4.10.4).

/** 도는 턴이 있어 되감기·다시 만들기를 거절한다. host가 같은 일에 주는 `turn.busy`(3003)와 같은 분류다 */
const TURN_BUSY = WIRE_ERRORS["turn.busy"].code;
/** 대상 item이 이 대화의 현재 가지에 없거나 그 자리에서 할 수 없다. host의 `thread.invalidTarget`(3005)과 같은 분류다 */
const INVALID_TARGET = WIRE_ERRORS["thread.invalidTarget"].code;

export type MessageCommands = {
  /**
   * 이 메시지를 포함해 그 자리까지 갈라 새 대화를 만든다(`thread.fork { at }`). 성공하면 새 대화를 연다.
   * 도는 턴이 있어도 막지 않는다(갈라내기는 host가 판정한다).
   */
  forkAt(threadId: ThreadId, itemId: ItemId): Promise<Result<null, CommandError>>;
  /**
   * 대화의 leaf를 이 메시지로 옮긴다(`thread.revert { to }`). 이 메시지는 남고 뒤의 가지는 떠난 가지가 된다.
   * 파일 변경은 되돌리지 않는다. 도는 턴이 있으면 `rejected(3003)`으로 거절한다.
   */
  rewindTo(threadId: ThreadId, itemId: ItemId): Promise<Result<null, CommandError>>;
  /**
   * 답(어시스턴트 메시지)이나 그 답 앞 사용자 메시지를 다시 만든다. 그 사용자 메시지까지 되감은 뒤 글을 같은 자리에서 다시 턴으로 보낸다.
   * 사용자 메시지를 주면 그 메시지부터 다시 한다. 글이 없는 사용자 메시지나 대상이 열린 대화에 없으면 `rejected(3005)`다.
   * 되감기가 성공하고 턴 보내기가 실패하면 대화는 사용자 메시지에서 멈춘다(되감기는 되돌리지 않는다).
   */
  regenerate(threadId: ThreadId, itemId: ItemId): Promise<Result<null, CommandError>>;
};

export type MessageCommandDeps = {
  /** 쓰기 연결(`commands.ts`의 `withWriteConnection`). 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다 */
  readonly write: <T>(
    run: (connection: HostConnection) => Promise<T>,
  ) => Promise<Result<T, CommandError>>;
  /** 엔진 거울. 도는 턴을 읽고, 다시 만들 글을 열린 대화의 확정 item에서 찾는다 */
  readonly engine: Pick<EngineStore, "read" | "flush">;
  /** 보낸 턴이 성공하면 관찰 표식을 지운다(`startTurn`과 같다) */
  readonly ui: Pick<UiStore, "actions">;
  /** 갈라낸 새 대화를 선택하고 연다(`forkThread`와 같은 후처리) */
  readonly openForked: (threadId: ThreadId) => void;
  /** `thread.locked`로 막히면 대화 상자를 띄운다(`showLockedIfLocked`) */
  readonly showLocked: (threadId: ThreadId, error: CommandError) => void;
  /** `turn.start`의 멱등 키를 새로 만든다 */
  readonly newRequestId: () => string;
};

/** 다시 보낼 자리. `userItemId`까지 되감고 `text`를 턴으로 보낸다 */
type ResendTarget = { readonly userItemId: ItemId; readonly text: string };

function textTargetOf(item: ItemRecord): ResendTarget | null {
  const text = messageCopyText(item);
  return text === null ? null : { userItemId: item.itemId, text };
}

/**
 * 다시 만들 자리를 고른다. 사용자 메시지면 그 자신이고, 답이면 현재 가지에서 그 앞의 가장 가까운 사용자 메시지다.
 * 대화가 열려 있지 않거나 대상이 확정 기록에 없거나 글이 없으면 null이다.
 */
function resendTargetOf(
  mirror: EngineMirror,
  threadId: ThreadId,
  itemId: ItemId,
): ResendTarget | null {
  const transcript = mirror.transcript;
  if (transcript?.status !== "ready" || transcript.threadId !== threadId) return null;
  const picked = transcript.items[itemId];
  if (picked === undefined) return null;
  if (picked.kind === "user") return textTargetOf(picked);
  if (picked.kind !== "assistant") return null;
  for (let i = transcript.itemIds.indexOf(itemId) - 1; i >= 0; i -= 1) {
    const id = transcript.itemIds[i];
    const item = id === undefined ? undefined : transcript.items[id];
    if (item?.kind === "user") return textTargetOf(item);
  }
  return null;
}

export function createMessageCommands(deps: MessageCommandDeps): MessageCommands {
  const { write, engine, ui, openForked, showLocked, newRequestId } = deps;

  /** 이 대화에 도는 턴이 있는가. 거울을 먼저 맞춰 방금 보낸 턴이 보이게 한다 */
  const runningAt = (threadId: ThreadId): boolean => {
    engine.flush();
    return selectThread(engine.read.getState(), threadId)?.status === "running";
  };

  /** 되감기 한 번. 막히면 대화 상자를 띄우고 오류를 그대로 돌려준다 */
  const revert = async (
    threadId: ThreadId,
    itemId: ItemId,
  ): Promise<Result<null, CommandError>> => {
    const done = await write((c) => c.request("thread.revert", { threadId, to: itemId }));
    if (!done.ok) {
      showLocked(threadId, done.error);
      return done;
    }
    return ok(null);
  };

  return {
    async forkAt(threadId, itemId) {
      const forked = await write((c) => c.request("thread.fork", { threadId, at: itemId }));
      if (!forked.ok) return forked;
      openForked(forked.value.threadId);
      return ok(null);
    },
    async rewindTo(threadId, itemId) {
      if (runningAt(threadId)) return err({ kind: "rejected", code: TURN_BUSY });
      return revert(threadId, itemId);
    },
    async regenerate(threadId, itemId) {
      if (runningAt(threadId)) return err({ kind: "rejected", code: TURN_BUSY });
      const target = resendTargetOf(engine.read.getState(), threadId, itemId);
      if (target === null) return err({ kind: "rejected", code: INVALID_TARGET });
      const reverted = await revert(threadId, target.userItemId);
      if (!reverted.ok) return reverted;
      // 위의 확인과 이 전송 사이에 턴이 시작됐다면 host가 `turn.busy`(3003)로 거절한다(`whenBusy`를 주지 않으므로 큐에 넣지 않는다). 되감기는 그대로 남는다
      const started = await write((c) =>
        c.request("turn.start", { threadId, input: target.text, requestId: newRequestId() }),
      );
      if (!started.ok) {
        showLocked(threadId, started.error);
        return started;
      }
      ui.actions.setObserving(threadId, false);
      return ok(null);
    },
  };
}
