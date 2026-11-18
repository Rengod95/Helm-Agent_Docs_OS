import { assertNever, type Bug } from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import type { RewindScope, RewindUndoState } from "@fresnel/contracts/records";
import type { FileRewindError } from "@fresnel/contracts/services";
import {
  wireError,
  type WireError,
  type WireHandler,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import type { Engine, FileRewindPort } from "../types.ts";
import { wireErrorOfLifecycle, wireErrorOfStore } from "../store-error.ts";
import { notImplemented } from "./not-implemented.ts";
import { requireOwned, requireThread } from "./thread.ts";

// L4.host-service.spec 파일 되감기 절, F.wire-settings.spec §3.3.1. 파일 되감기 메서드 다섯 개의 처리기다.
// 파일은 서비스(cap-workspace)가, 대화의 leaf는 `ports.threads`가 옮긴다. 순서: 파일을 먼저 되돌리고 대화를 옮긴다(서비스가 `to` 뒤의
// 기록을 범위로 잡으려면 leaf가 아직 그 자리에 있어야 한다). 파일 내용은 응답·오류·로그 어디에도 싣지 않는다(경로와 해시만).

export type FileRewindMethod =
  | "thread.rewindPreview"
  | "thread.rewind"
  | "thread.rewindOverwrite"
  | "thread.rewindUndo"
  | "thread.turnFiles";

/**
 * 파일 되감기 처리기 다섯 개. 포트가 없는 조립(원본 저장 포트가 없다)에서는 다섯 메서드 모두 `notImplemented`다.
 * 그러면 `host.hello`의 features에서도 빠진다(remote.ts와 같은 규칙).
 */
export function createThreadRewindHandlers(engine: Engine): Pick<WireHandlers, FileRewindMethod> {
  const port = engine.ports.fileRewind;
  if (port === undefined) {
    return {
      "thread.rewindPreview": notImplemented("thread.rewindPreview"),
      "thread.rewind": notImplemented("thread.rewind"),
      "thread.rewindOverwrite": notImplemented("thread.rewindOverwrite"),
      "thread.rewindUndo": notImplemented("thread.rewindUndo"),
      "thread.turnFiles": notImplemented("thread.turnFiles"),
    };
  }
  return {
    "thread.rewindPreview": rewindPreviewHandler(engine, port),
    "thread.rewind": rewindHandler(engine, port),
    "thread.rewindOverwrite": rewindOverwriteHandler(engine, port),
    "thread.rewindUndo": rewindUndoHandler(engine, port),
    "thread.turnFiles": turnFilesHandler(engine, port),
  };
}

function rewindPreviewHandler(
  engine: Engine,
  port: FileRewindPort,
): WireHandler<"thread.rewindPreview"> {
  return async (params) => {
    requireThread(engine, params.threadId, "thread.rewindPreview");
    const previewed = await port.service.preview({ threadId: params.threadId, to: params.to });
    if (!previewed.ok) throw fileRewindFailure(previewed.error, "thread.rewindPreview");
    return previewed.value;
  };
}

function rewindHandler(engine: Engine, port: FileRewindPort): WireHandler<"thread.rewind"> {
  return async (params) => {
    const { threadId, to } = params;
    const scope: RewindScope = params.scope ?? "both";
    requireRewindWrite(engine, threadId, "thread.rewind");
    const rewindId = port.newRewindId();
    // 대화만 되감는다. 파일을 건드리지 않고 되감기 기록도 남기지 않는다(되돌릴 수 없다)
    if (scope === "conversation") {
      const reverted = await engine.ports.threads.revert(threadId, to);
      if (!reverted.ok) throw wireErrorOfLifecycle(reverted.error, "thread.rewind");
      return {
        rewindId,
        leaf: reverted.value.leaf,
        headSeq: reverted.value.position.seq,
        files: [],
        kept: [],
        untracked: [],
      };
    }
    // 되감기 직전 leaf를 먼저 적는다. 서비스가 `to` 뒤의 기록을 범위로 잡고, 되돌리기가 이 leaf로 대화를 되돌린다
    const oldLeafEventId = await leafOrThrow(engine, threadId, "thread.rewind");
    // 파일 쪽 적용. `to`가 활성 가지에 없으면 파일을 건드리기 전에 서비스가 거절한다
    const applied = await port.service.apply({
      threadId,
      to,
      scope,
      overwrite: params.overwrite ?? [],
      rewindId,
      oldLeafEventId,
    });
    if (!applied.ok) throw fileRewindFailure(applied.error, "thread.rewind");
    const result = {
      rewindId,
      files: [...applied.value.files],
      kept: [...applied.value.kept],
      untracked: [...applied.value.untracked],
    };
    if (scope === "files") return result;
    // 파일이 되돌아간 뒤 대화를 옮긴다. 여기서 거절되면 파일 되감기는 이미 남아 있다(`rewind_applied`), `thread.rewindUndo`로 되돌린다
    const reverted = await engine.ports.threads.revert(threadId, to);
    if (!reverted.ok) throw wireErrorOfLifecycle(reverted.error, "thread.rewind");
    return {
      ...result,
      leaf: reverted.value.leaf,
      headSeq: reverted.value.position.seq,
    };
  };
}

function rewindOverwriteHandler(
  engine: Engine,
  port: FileRewindPort,
): WireHandler<"thread.rewindOverwrite"> {
  return async (params) => {
    requireRewindWrite(engine, params.threadId, "thread.rewindOverwrite");
    const overwritten = await port.service.overwrite({
      threadId: params.threadId,
      rewindId: params.rewindId,
      paths: params.paths,
    });
    if (!overwritten.ok) throw fileRewindFailure(overwritten.error, "thread.rewindOverwrite");
    return { files: [...overwritten.value.files], kept: [...overwritten.value.kept] };
  };
}

function rewindUndoHandler(engine: Engine, port: FileRewindPort): WireHandler<"thread.rewindUndo"> {
  return async (params) => {
    const { threadId, rewindId } = params;
    requireRewindWrite(engine, threadId, "thread.rewindUndo");
    const started = await port.startedOf(threadId, rewindId);
    if (!started.ok) throw wireErrorOfStore(started.error, "thread.rewindUndo");
    if (started.value === undefined) throw unknownRewind();
    const { scope, targetEventId, oldLeafEventId } = started.value;
    // 대화가 되감기에 들었고 leaf가 그 지점에 그대로 있을 때만 대화를 되감기 직전으로 옮긴다. 파일 되돌리기보다 먼저 한다
    // (서비스가 `conversation`을 leaf로 판정한다). leaf가 움직였으면 대화는 건드리지 않는다
    if (scope !== "files" && oldLeafEventId !== null) {
      const leaf = await leafOrThrow(engine, threadId, "thread.rewindUndo");
      if (leaf === targetEventId) {
        const restored = await engine.ports.threads.restoreLeaf(threadId, oldLeafEventId);
        if (!restored.ok) throw wireErrorOfLifecycle(restored.error, "thread.rewindUndo");
      }
    }
    const undone = await port.service.undoFiles({ threadId, rewindId });
    if (!undone.ok) throw fileRewindFailure(undone.error, "thread.rewindUndo");
    // 대화 쪽 상태는 되돌리기가 커밋한 값이다. 커밋은 leaf를 옮기므로(저장소의 투영) 지금의 leaf로 다시 셈하면 틀린다.
    // 같은 되돌리기를 다시 불러도 처음 값이 나온다. 커밋이 없었으면(적용 기록이 없는 되감기) 지금의 leaf로 셈한다
    const recorded = await port.undoneConversationOf(threadId, rewindId);
    if (!recorded.ok) throw wireErrorOfStore(recorded.error, "thread.rewindUndo");
    const conversation =
      recorded.value ??
      conversationStateOf(
        scope,
        oldLeafEventId,
        await leafOrThrow(engine, threadId, "thread.rewindUndo"),
      );
    return { files: [...undone.value.files], conversation };
  };
}

function turnFilesHandler(engine: Engine, port: FileRewindPort): WireHandler<"thread.turnFiles"> {
  return async (params) => {
    requireThread(engine, params.threadId, "thread.turnFiles");
    const view = await port.service.turnFiles({
      threadId: params.threadId,
      turnId: params.turnId ?? null,
    });
    if (!view.ok) throw fileRewindFailure(view.error, "thread.turnFiles");
    const incomplete = await port.service.incomplete({ threadId: params.threadId });
    if (!incomplete.ok) throw fileRewindFailure(incomplete.error, "thread.turnFiles");
    return { turns: [...view.value.turns], incomplete: [...incomplete.value] };
  };
}

/**
 * 쓰는 되감기의 사전 검사. 파일을 만지기 전에 본다(F wire §3.3.1 파일 되감기 글머리): 대화가 있는가(3001), 쓰기 소유가 있는가(3002),
 * 닫히지 않았는가(3007), 열린 turn이 없는가(3003, 저장소의 투영 기준 `openTurnOf`). 대상 항목이 가지에 있는지는 서비스가 파일 쓰기 전에 본다.
 */
function requireRewindWrite(engine: Engine, threadId: ThreadId, where: string): void {
  requireThread(engine, threadId, where);
  requireOwned(engine, threadId);
  const closed = engine.ports.threads.closed(threadId);
  if (!closed.ok) throw wireErrorOfStore(closed.error, `${where} closed`);
  if (closed.value) throw wireError("thread.closed", { details: { threadId } });
  const open = engine.ports.threads.openTurnOf(threadId);
  if (!open.ok) throw wireErrorOfStore(open.error, `${where} open turn`);
  if (open.value !== undefined) {
    throw wireErrorOfLifecycle({ kind: "turn_running", turnId: open.value }, where);
  }
}

/** 현재 leaf. 읽기 실패는 저장소 오류다. 빈 대화는 null이다 */
async function leafOrThrow(
  engine: Engine,
  threadId: ThreadId,
  where: string,
): Promise<EventId | null> {
  const leaf = await engine.ports.threads.leafOf(threadId);
  if (!leaf.ok) throw wireErrorOfStore(leaf.error, `${where} leaf`);
  return leaf.value;
}

/** 대화 쪽 상태(F.wire-settings: `RewindUndoState`). 파일만 되감았으면 `not_included`, leaf가 되감기 직전이면 `restored` */
function conversationStateOf(
  scope: RewindScope,
  oldLeafEventId: EventId | null,
  leaf: EventId | null,
): RewindUndoState {
  if (scope === "files") return "not_included";
  return oldLeafEventId !== null && leaf === oldLeafEventId ? "restored" : "moved_on";
}

/**
 * 되감기 식별자를 모르면 `jsonrpc.invalidParams`다. 되감기 식별자는 요청 인수이고, 기존 와이어 오류 가운데 알 수 없는 인수를
 * 뜻하는 것이 이것뿐이다. 식별자 값은 싣지 않는다
 */
function unknownRewind(): WireError {
  return wireError("jsonrpc.invalidParams", {
    details: { issues: [{ path: "/rewindId", message: "unknown rewind" }] },
  });
}

/**
 * 서비스 오류를 와이어 오류로 옮긴다. 대상 항목의 두 경우는 `thread.revert`의 `invalid_target`과 같은 오류(3005, 사유 값)다.
 * `store_failed`의 원인 문자열은 서비스가 만든 짧은 종류 이름이다(행이 깨졌으면 `row_invalid:…`).
 */
function fileRewindFailure(error: FileRewindError, where: string): WireError | Bug {
  switch (error.kind) {
    case "thread_not_found":
      return wireError("thread.notFound", { details: { threadId: error.threadId } });
    case "target_not_found":
      return wireError("thread.invalidTarget", { details: { reason: "item_not_found" } });
    case "target_not_on_branch":
      return wireError("thread.invalidTarget", { details: { reason: "not_on_branch" } });
    case "rewind_not_found":
      return unknownRewind();
    case "store_failed":
      return storeFailure(error.cause, where);
    case "cancelled":
      return wireError("request.cancelled");
    default:
      return assertNever(error, "FileRewindError");
  }
}

function storeFailure(cause: string, where: string): WireError {
  if (cause === "busy") return wireErrorOfStore({ kind: "busy" }, where);
  if (cause.startsWith("row_invalid")) {
    return wireErrorOfStore({ kind: "row_invalid", where: cause }, where);
  }
  return wireErrorOfStore({ kind: "io", code: cause }, where);
}
