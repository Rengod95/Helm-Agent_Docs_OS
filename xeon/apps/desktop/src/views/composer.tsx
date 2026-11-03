import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  useEngineState,
  useLinkPhase,
  useOpenThreadId,
  useThreadRunning,
} from "../state/engine/index.ts";
import { useComposerRequest, useObserving } from "../state/ui/index.ts";
import { useCommands, type CommandError } from "./commands.ts";
import { composerDisabledReason, createEnterGuard, createSendLatch } from "./composer-model.ts";
import { useSetupNeeded } from "./setup-needed.ts";

// 입력창. 입력 중인 글자는 이 부품만 쓰므로 로컬 상태다(FS-04).
// requestId는 같은 입력의 재시도가 같은 값을 쓰도록 실패했을 때 유지하고, 성공하면 새로 만든다(spec 4.13).
// ⌘L과 명령 팔레트의 슬래시 명령은 `ComposerRequest`로 온다. 받으면 초점을 주고 빈 입력창에만 글을 채운 뒤 요청을 지운다.

function newRequestId(): string {
  return crypto.randomUUID();
}

function sendErrorText(error: CommandError): string {
  if (error.kind === "offline") return t("desktop.composer.error.offline");
  if (error.kind === "switching") return t("desktop.composer.error.switching");
  if (error.kind === "locked") return t("desktop.composer.error.locked");
  if (error.kind === "unsupported") return t("desktop.composer.error.unsupported");
  if (error.kind === "rejected" && error.code !== null) {
    return t("desktop.composer.error.rejected", { code: error.code });
  }
  return t("desktop.composer.error.failed");
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const request = useComposerRequest();
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

  // 요청은 입력창이 받는 순간 지운다. 입력 중인 글이 있으면 채우지 않고 초점만 준다(글을 지우지 않는다)
  useEffect(() => {
    if (request === null) return;
    if (request.insert !== null && draftRef.current === "") {
      draftRef.current = request.insert;
      setDraft(request.insert);
    }
    textarea.current?.focus();
    commands.settleComposerRequest();
  }, [request, commands]);

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
        ref={textarea}
        aria-label={t("desktop.composer.input.label")}
        rows={3}
        value={draft}
        placeholder={props.disabledReason ?? t("desktop.composer.placeholder")}
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
            {t("desktop.composer.interrupt.button")}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={props.disabledReason !== null || sending || draft.trim() === ""}
        >
          {t("desktop.composer.send.button")}
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
          <span className="dim">{t("desktop.composer.observing.notice")}</span>{" "}
          <button
            type="button"
            onClick={() => {
              commands.retryWrite(threadId);
            }}
          >
            {t("desktop.composer.retryWrite.button")}
          </button>
        </div>
      ) : null}
      <ComposerFor key={threadId} threadId={threadId} disabledReason={disabledReason} />
    </>
  );
}
