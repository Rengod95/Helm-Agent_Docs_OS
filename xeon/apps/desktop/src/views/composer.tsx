import { detach, rethrow } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  useEngineState,
  useLinkPhase,
  useOpenThreadId,
  useThreadRunning,
} from "../state/engine/index.ts";
import { useObserving } from "../state/ui/index.ts";
import { useCommands, type CommandError } from "./commands.ts";
import { composerDisabledReason, createEnterGuard, createSendLatch } from "./composer-model.ts";
import { useSetupNeeded } from "./setup-needed.ts";

// 입력창. 입력 중인 글자는 이 부품만 쓰므로 로컬 상태다(FS-04).
// requestId는 같은 입력의 재시도가 같은 값을 쓰도록 실패했을 때 유지하고, 성공하면 새로 만든다(spec 4.13).

function newRequestId(): string {
  return crypto.randomUUID();
}

function sendErrorText(error: CommandError): string {
  if (error.kind === "offline") return "엔진에 연결되어 있지 않습니다.";
  if (error.kind === "locked") return "다른 곳이 이 대화를 쓰고 있어 보내지 못했습니다.";
  if (error.kind === "unsupported") return "이 엔진은 이 요청을 지원하지 않습니다.";
  if (error.kind === "rejected" && error.code !== null) {
    return `엔진이 거절했습니다 (${error.code}).`;
  }
  return "보내지 못했습니다.";
}

function ComposerFor(props: {
  readonly threadId: ThreadId;
  readonly disabledReason: string | null;
}): ReactNode {
  const commands = useCommands();
  const running = useThreadRunning(props.threadId);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const requestId = useRef<string>(newRequestId());
  // 최신 입력. 한글 조합이 끝난 직후의 keydown은 React 상태가 아직 갱신되기 전일 수 있다
  const draftRef = useRef("");
  const guard = useRef(createEnterGuard());
  // sending 상태는 비동기라 연속 Enter를 못 막는다. 동기 잠금으로 막는다
  const latch = useRef(createSendLatch());

  const send = async (): Promise<void> => {
    const text = draftRef.current.trim();
    if (text === "" || props.disabledReason !== null) return;
    if (!latch.current.tryAcquire()) return;
    setSending(true);
    setError(null);
    // 보내는 즉시 비운다. 남은 조합 글자가 두 번째 메시지가 되지 않게 한다
    draftRef.current = "";
    setDraft("");
    const result = await commands.sendTurn(props.threadId, text, requestId.current);
    latch.current.release();
    setSending(false);
    if (result.ok) {
      requestId.current = newRequestId();
      return;
    }
    // 실패하면 입력을 돌려주고(그 사이 새로 쓴 것이 없을 때만) 오류를 보인다
    if (draftRef.current === "") {
      draftRef.current = text;
      setDraft(text);
    }
    setError(sendErrorText(result.error));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // 한글 조합 중의 Enter는 글자 확정이다. 보내지 않는다(WebKit은 keyCode 229, compositionend가 먼저)
    if (
      !guard.current.isSendEnter(
        {
          key: event.key,
          shiftKey: event.shiftKey,
          isComposing: event.nativeEvent.isComposing,
          // oxlint-disable-next-line typescript/no-deprecated -- keyCode는 폐기 표시지만 WebKit이 IME 처리 중 Enter keydown에 실어 보내는 값(229)이라 읽는다 (review.macos-checklist M-11)
          keyCode: event.nativeEvent.keyCode,
        },
        event.timeStamp,
      )
    )
      return;
    event.preventDefault();
    detach(send(), rethrow);
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        detach(send(), rethrow);
      }}
    >
      <textarea
        aria-label="메시지"
        rows={3}
        value={draft}
        placeholder={
          props.disabledReason ?? "메시지를 입력하세요. Enter로 보내고 Shift+Enter로 줄을 바꿉니다."
        }
        disabled={props.disabledReason !== null}
        onChange={(event) => {
          draftRef.current = event.currentTarget.value;
          setDraft(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          guard.current.compositionStart();
        }}
        onCompositionEnd={(event) => {
          guard.current.compositionEnd(event.timeStamp);
        }}
      />
      <div className="composer-actions">
        {error === null ? null : (
          <span className="error" role="alert">
            {error}
          </span>
        )}
        {running ? (
          <button
            type="button"
            onClick={() => {
              detach(commands.interrupt(props.threadId), rethrow);
            }}
          >
            중단
          </button>
        ) : null}
        <button
          type="submit"
          disabled={props.disabledReason !== null || sending || draft.trim() === ""}
        >
          보내기
        </button>
      </div>
    </form>
  );
}

export function Composer(): ReactNode {
  const commands = useCommands();
  const threadId = useOpenThreadId();
  const engine = useEngineState();
  const phase = useLinkPhase();
  const setupNeeded = useSetupNeeded();
  const observing = useObserving(threadId);
  if (threadId === null) return null;
  const disabledReason = composerDisabledReason({
    engineRunning: engine?.kind === "running",
    phase,
    observing,
    setupNeeded,
  });
  // thread가 바뀌면 입력 중이던 글자를 버린다(key)
  return (
    <>
      {observing ? (
        <div className="observing" role="status">
          <span className="dim">관찰 중입니다.</span>{" "}
          <button
            type="button"
            onClick={() => {
              commands.retryWrite(threadId);
            }}
          >
            쓰기 다시 시도
          </button>
        </div>
      ) : null}
      <ComposerFor key={threadId} threadId={threadId} disabledReason={disabledReason} />
    </>
  );
}
