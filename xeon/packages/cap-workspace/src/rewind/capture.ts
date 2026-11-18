import { randomUUID } from "node:crypto";
import { err, ok, type Result } from "@fresnel/contracts";
import type { CallContext } from "@fresnel/contracts/capabilities";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import {
  commitKeyPart,
  type WorkspaceCapturedEntry,
  type WorkspaceFilesCapturedPayload,
} from "@fresnel/contracts/records";
import { sha256Bytes, sha256Text } from "./hash.ts";
import { isGitPath } from "./files.ts";
import type { RewindStore, ThreadRewindState } from "./store.ts";

// 편집 도구의 원본 저장(L1.persistence.spec §4.13.2 "원본 저장"). `write`·`edit`가 `atomicWrite` 직전,
// 경로별 줄 세우기 안에서 부른다. 커밋은 쓰기 전에 끝나야 한다. 커밋이 실패해도 도구는 막지 않고 로그만 남긴다.

/** 한 쓰기가 바꾸는 한 경로. 경로는 정규 경로다 */
interface CaptureChange {
  readonly path: string;
  /** 쓰기 전 바이트. 없던 파일이면 null */
  readonly before: Uint8Array | null;
  /** 쓸 내용의 바이트(문자열이면 UTF-8로 바꾼 것). 해시만 기록한다 */
  readonly after: Uint8Array;
}

export interface RewindCapture {
  /**
   * 원본을 저장한다. 문맥에 대화와 턴이 없으면 아무것도 하지 않는다. 절대 던지지 않는다.
   * 실패하면 `workspace.rewind_capture_failed`를 로그에 남긴다(경로와 사유 종류만).
   */
  capture(
    context: CallContext | undefined,
    requestId: string | undefined,
    change: CaptureChange,
  ): void;
}

interface CaptureInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly toolCallId: string | null;
  readonly requestKey: string;
  readonly change: CaptureChange;
}

function turnKey(turnId: TurnId, path: string): string {
  return `${turnId}\n${path}`;
}

function commitCapture(
  store: RewindStore,
  input: CaptureInput,
  entry: WorkspaceCapturedEntry,
): Result<void, string> {
  const payload: WorkspaceFilesCapturedPayload = { toolCallId: input.toolCallId, entries: [entry] };
  return store.commitEvent({
    threadId: input.threadId,
    turnId: input.turnId,
    requestKey: `rewind:capture:${commitKeyPart(input.requestKey, sha256Text)}`,
    kind: "workspace.files_captured",
    payload,
  });
}

/**
 * 한 쓰기의 기록. 그 턴에서 그 경로의 첫 쓰기면 옛 상태를 저장하고 `first:true`로 적는다. 이후 쓰기는 해시만 갱신한다.
 * 처음 기록이 실패하면 그 턴의 그 경로는 추적하지 않는다(이후 쓰기도 기록하지 않는다. 중간 내용을 옛 상태로 적지 않기 위해서다).
 */
function captureOne(store: RewindStore, input: CaptureInput): Result<void, string> {
  const state = store.stateOf(input.threadId);
  if (!state.ok) return err(state.error);
  const tracked: ThreadRewindState = state.value;
  const key = turnKey(input.turnId, input.change.path);
  const mark = tracked.turnPaths.get(key);
  if (mark === "untracked") return ok(undefined);
  const afterSha256 = sha256Bytes(input.change.after);
  if (mark === "tracked") {
    return commitCapture(store, input, {
      path: input.change.path,
      first: false,
      before: null,
      afterSha256,
    });
  }
  const before = store.snapshot(input.threadId, input.change.before);
  if (!before.ok) {
    tracked.turnPaths.set(key, "untracked");
    return err(before.error);
  }
  const committed = commitCapture(store, input, {
    path: input.change.path,
    first: true,
    before: before.value,
    afterSha256,
  });
  if (!committed.ok) {
    tracked.turnPaths.set(key, "untracked");
    return err(committed.error);
  }
  tracked.turnPaths.set(key, "tracked");
  return ok(undefined);
}

export function createRewindCapture(store: RewindStore): RewindCapture {
  return {
    capture(context, requestId, change) {
      const threadId = context?.threadId;
      const turnId = context?.turnId;
      if (threadId === undefined || turnId === undefined) return;
      // 사용자의 `.git` 안은 되감기 대상이 아니다. 기록하지 않아 복원도 건드리지 않는다
      if (isGitPath(change.path)) return;
      const toolCallId = context?.toolCallId ?? null;
      // 호출마다 다른 키여야 한다. 도구 호출 키가 없으면 임의 키를 쓴다(이 경우 재시도 멱등은 없다)
      const requestKey = requestId ?? toolCallId ?? randomUUID();
      const outcome = captureOne(store, { threadId, turnId, toolCallId, requestKey, change });
      if (!outcome.ok) {
        store.logger.warn("workspace.rewind_capture_failed", {
          path: change.path,
          reason: outcome.error,
        });
      }
    },
  };
}
