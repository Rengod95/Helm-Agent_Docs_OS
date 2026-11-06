import { detach, rethrow } from "@fresnel/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLinkPhase, useRunningCount } from "../state/engine/index.ts";
import { useDesktopShell, type DesktopShell } from "./desktop-shell-context.ts";
import type { OsNotifier } from "./os-notify.ts";
import { startShellIntents } from "./shell-intents.ts";
import { createTrayBridge, trayLabelsOf, type TrayBridge } from "./tray-bridge.ts";

// 셸 다리(B-10): 트레이 글과 진행 중 개수, OS 알림 듣기, 셸 의도 처리를 화면에 잇는다. 그리는 것은 없고 효과만 한다.
// 문맥이 없으면(웹) 아무 일도 하지 않는다. "새 대화"와 "대화 열기"는 App이 준다. 대화 이동 문맥(GoToThreadContext)은 Shell 안에서만 값이 있다.

export interface ShellBridgesProps {
  /** "새 대화"(⌘N과 같은 동작) */
  readonly onNewThread: () => void;
  /** 대화 열기(App의 `openThread`) */
  readonly onGoToThread: (threadId: string) => void;
}

export function ShellBridges(props: ShellBridgesProps): ReactNode {
  const shell = useDesktopShell();
  if (shell === null) return null;
  return (
    <>
      <TrayBridge shell={shell} />
      <NotifyBridge notifier={shell.notifier} />
      <IntentBridge
        shell={shell}
        onNewThread={props.onNewThread}
        onGoToThread={props.onGoToThread}
      />
    </>
  );
}

/** 진행 중 개수가 바뀌면 트레이 글을 보낸다. 언어가 바뀌면 트리가 다시 그려지며 이 다리가 새로 만들어진다 */
function TrayBridge(props: { readonly shell: DesktopShell }): ReactNode {
  const running = useRunningCount();
  const [bridge] = useState<TrayBridge>(() => createTrayBridge(props.shell.invoke));
  useEffect(() => {
    detach(bridge.update({ labels: trayLabelsOf(), running }), rethrow);
  }, [bridge, running]);
  return null;
}

/** 연결이 살아 있는 동안 `notify.delivered`를 듣는다. 연결이 바뀌면 구독을 다시 건다 */
function NotifyBridge(props: { readonly notifier: OsNotifier }): ReactNode {
  const phase = useLinkPhase();
  const { notifier } = props;
  useEffect(() => {
    if (phase !== "live") return undefined;
    return notifier.listen();
  }, [notifier, phase]);
  return null;
}

/** 셸 의도 듣기. 함수는 매 그림마다 바뀌므로 최신 것을 참조로 읽고, 듣기는 셸이 바뀔 때만 다시 건다 */
function IntentBridge(props: {
  readonly shell: DesktopShell;
  readonly onNewThread: () => void;
  readonly onGoToThread: (threadId: string) => void;
}): ReactNode {
  const { shell } = props;
  const latest = useRef({ onNewThread: props.onNewThread, onGoToThread: props.onGoToThread });
  useEffect(() => {
    latest.current = { onNewThread: props.onNewThread, onGoToThread: props.onGoToThread };
  });
  useEffect(
    () =>
      startShellIntents({
        invoke: shell.invoke,
        listen: shell.subscribeIntent,
        focusTargets: { window, document },
        visible: () => document.visibilityState === "visible",
        newThread: () => {
          latest.current.onNewThread();
        },
        openThread: (threadId) => {
          latest.current.onGoToThread(threadId);
        },
      }),
    [shell],
  );
  return null;
}
