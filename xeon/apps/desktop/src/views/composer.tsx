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
  const composing = useRef(false);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (text === "" || sending || props.disabledReason !== null) return;
    setSending(true);
    setError(null);
    const result = await commands.sendTurn(props.threadId, text, requestId.current);
    setSending(false);
    if (result.ok) {
      setDraft("");
      requestId.current = newRequestId();
      return;
    }
    setError(sendErrorText(result.error));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // 한글 조합 중의 Enter는 글자 확정이다. 보내지 않는다
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      composing.current ||
      event.nativeEvent.isComposing
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
          setDraft(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
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
  const observing = useObserving(threadId);
  if (threadId === null) return null;
  const disabledReason =
    engine?.kind !== "running"
      ? "엔진이 꺼져 있어 보낼 수 없습니다."
      : phase === "live" || phase === "syncing"
        ? observing
          ? "다른 곳이 이 대화를 쓰고 있어 관찰만 합니다."
          : null
        : "연결을 맞추는 중입니다.";
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
