import type { ThreadId } from "@fresnel/contracts/conversation";

// 사람이 없는 대화(예약 실행이 만든 대화)의 목록. `ask_user`가 이 목록으로 "정말 못 묻는 실행"을 가린다(F-07).
// Drive turn은 도구 승인 정책상 `interactive`가 거짓이지만, 화면이 붙은 대화의 Drive는 사람에게 물을 수 있다.
// 그래서 질문은 호출 문맥의 `interactive`가 아니라 대화가 무인인지로 정한다. 프로세스가 다시 뜨면 목록은 비고, 그 대화는 대화형으로 본다.

export interface UnattendedThreads {
  /** 무인 대화로 적는다 */
  add(threadId: ThreadId): void;
  has(threadId: ThreadId | undefined): boolean;
}

export function createUnattendedThreads(): UnattendedThreads {
  const threads = new Set<ThreadId>();
  return {
    add: (threadId) => {
      threads.add(threadId);
    },
    has: (threadId) => threadId !== undefined && threads.has(threadId),
  };
}

/**
 * `ask_user`가 사람에게 물을 수 있는가. 호출 문맥이 대화형이거나, 주 대화의 호출이 무인이 아닌 대화(화면이 붙은 대화의 Drive turn)에서 났으면 참이다.
 * 서브에이전트와 백그라운드 호출은 문맥의 값을 그대로 따른다
 */
export function askReachesPerson(
  context: {
    readonly interactive?: boolean;
    readonly threadId?: ThreadId;
    readonly caller: { readonly kind: string; readonly agent?: string };
  },
  unattended: UnattendedThreads | undefined,
): boolean {
  if (context.interactive !== false) return true;
  const fromMain = context.caller.kind === "model" && context.caller.agent === "main";
  return fromMain && unattended !== undefined && !unattended.has(context.threadId);
}
