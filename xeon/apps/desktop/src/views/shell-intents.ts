// 셸 의도 처리(B-10). 트레이 메뉴의 "새 대화"와 "열기"와 알림 누르기로 온 요청을 WebView가 받아 처리한다.
// 셸은 의도를 큐에 두고 `shell-intent` 이벤트로 깨운다. WebView는 시작할 때, 깨우는 이벤트가 올 때, 창이 앞으로 올라올 때
// `shell_take_intents`로 큐를 비운다. 창이 앞으로 올라오면 `notify_take_target`으로 마지막 알림 대화도 가져간다.
// 명령이 거부되거나 답이 모양과 다르면 값으로 넘기고 아무 일도 하지 않는다(다음 깨움에 다시 받는다).
import { assertNever, attemptAsync, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { notifyTargetOf } from "./os-notify-model.ts";

/** 셸이 떠 있는 WebView를 깨우는 이벤트 이름. Rust `shell_intent::EVENT`와 같다 */
export const SHELL_INTENT_EVENT = "shell-intent";

export type ShellIntent =
  | { readonly kind: "newThread" }
  | { readonly kind: "openThread"; readonly threadId: ThreadId };

export type ShellInvoke = (
  command: "shell_take_intents" | "notify_take_target",
) => Promise<unknown>;

/** 깨우기 이벤트를 듣는다. 반환값은 해제 함수다. 운영은 main.tsx가 셸 다리의 `listen`을 감싸 넘긴다 */
export type SubscribeShellIntent = (onWake: () => void) => Promise<() => void>;

export interface ShellIntentPort {
  readonly invoke: ShellInvoke;
  readonly listen: SubscribeShellIntent;
  /** 창이 앞으로 올라왔는지 보는 사건의 대상. 운영은 window(focus)와 document(visibilitychange)다 */
  readonly focusTargets: { readonly window: EventTarget; readonly document: EventTarget };
  /** 문서가 보이는가. 숨은 창에서 올라온 사건은 무시한다 */
  readonly visible: () => boolean;
  readonly newThread: () => void;
  readonly openThread: (threadId: string) => void;
}

function intentOf(raw: unknown): ShellIntent | null {
  if (typeof raw !== "object" || raw === null || !("kind" in raw)) return null;
  if (raw.kind === "newThread") return { kind: "newThread" };
  if (raw.kind === "openThread" && "threadId" in raw) {
    const threadId = notifyTargetOf(raw.threadId);
    return threadId === null ? null : { kind: "openThread", threadId };
  }
  return null;
}

/** 큐의 답을 의도 목록으로 읽는다. 배열이 아니면 빈 목록이고, 모르는 항목은 뺀다 */
export function intentsOf(reply: unknown): readonly ShellIntent[] {
  if (!Array.isArray(reply)) return [];
  const items: readonly unknown[] = reply;
  return items.flatMap((item) => {
    const intent = intentOf(item);
    return intent === null ? [] : [intent];
  });
}

/** 큐를 비우고 받은 의도를 차례로 처리한다. 명령이 거부되면 아무 일도 하지 않는다 */
export async function drainShellIntents(port: ShellIntentPort): Promise<void> {
  const reply = await attemptAsync(() => port.invoke("shell_take_intents"));
  if (!reply.ok) return;
  for (const intent of intentsOf(reply.value)) {
    switch (intent.kind) {
      case "newThread":
        port.newThread();
        break;
      case "openThread":
        port.openThread(intent.threadId);
        break;
      default:
        assertNever(intent, "ShellIntent");
    }
  }
}

/**
 * 마지막 알림 대화를 가져가 연다. 가져갈 것이 없거나 명령이 거부되면 아무 일도 하지 않는다.
 * 대화 목록에 없는 대화는 `openThread`가 무시한다.
 */
export async function takeNotifyTarget(port: ShellIntentPort): Promise<void> {
  const reply = await attemptAsync(() => port.invoke("notify_take_target"));
  if (!reply.ok) return;
  const threadId = notifyTargetOf(reply.value);
  if (threadId !== null) port.openThread(threadId);
}

/**
 * 셸 의도 듣기를 시작한다. 시작할 때, 깨우기 이벤트가 올 때, 창이 앞으로 올라올 때 큐를 비운다.
 * 앞으로 올라온 때는 알림 대화도 가져간다. 반환값을 부르면 듣기를 멈춘다.
 */
export function startShellIntents(port: ShellIntentPort): () => void {
  let stopped = false;
  let unlisten: (() => void) | null = null;
  const { window: win, document: doc } = port.focusTargets;
  const wake = (): void => {
    detach(drainShellIntents(port), rethrow);
  };
  const front = (): void => {
    if (!port.visible()) return;
    wake();
    detach(takeNotifyTarget(port), rethrow);
  };
  win.addEventListener("focus", front);
  doc.addEventListener("visibilitychange", front);
  const attach = async (): Promise<void> => {
    const stop = await port.listen(wake);
    // 듣기를 멈춘 뒤에 등록이 끝나면 바로 해제한다
    if (stopped) stop();
    else unlisten = stop;
  };
  detach(attach(), rethrow);
  wake();
  return () => {
    stopped = true;
    win.removeEventListener("focus", front);
    doc.removeEventListener("visibilitychange", front);
    unlisten?.();
  };
}
