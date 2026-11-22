// 테스트 챗 창(C7)의 상태. 창은 Craft 어디서나 떠 있고 내비를 옮겨도 남으므로 화면 부품 밖의 작은 저장소가 든다
// (트레이스의 `target.ts`와 같은 방식). 화면 위치 값(`AreaPlace`)에는 화면 id만 있어 창을 담지 않는다. 앱을 다시 켜면 창은 닫힌 채 시작한다.
import { useSyncExternalStore } from "react";
import { assertNever } from "@fresnel/contracts";
import type { ContextRef, ThreadId } from "@fresnel/contracts/conversation";
import type { CommandError } from "../../commands.ts";
import {
  DEFAULT_TEST_CHAT_SHAPE,
  ZERO_OFFSET,
  type Offset,
  type TestChatShape,
} from "./window-model.ts";

type TestChatPhase =
  /** 창이 닫혔다 */
  | { readonly kind: "closed" }
  /** `craftChat.open`을 기다린다. 창은 머리와 뼈대로 먼저 선다 */
  | { readonly kind: "opening"; readonly plugin: string | null }
  | { readonly kind: "failed"; readonly plugin: string | null; readonly error: CommandError }
  | { readonly kind: "ready"; readonly threadId: ThreadId; readonly plugin: string | null };

export interface TestChatWindow {
  readonly phase: TestChatPhase;
  readonly collapsed: boolean;
  /** 이번에 열 때 들고 온 맥락 참조. 칩으로 보인다(엔진은 열 때 한 번 기록한다) */
  readonly contexts: readonly ContextRef[];
  /** 끌어 옮긴 거리(CSS px). 꼴을 바꾸거나 다시 열면 0이다 */
  readonly offset: Offset;
  readonly shape: TestChatShape;
}

export type TestChatEvent =
  | {
      readonly type: "opening";
      readonly plugin: string | null;
      readonly contexts: readonly ContextRef[];
    }
  | { readonly type: "opened"; readonly threadId: ThreadId; readonly plugin: string | null }
  | { readonly type: "failed"; readonly error: CommandError }
  | { readonly type: "collapse"; readonly collapsed: boolean }
  | { readonly type: "close" }
  | { readonly type: "move"; readonly offset: Offset }
  | { readonly type: "shape"; readonly shape: TestChatShape };

export const CLOSED_WINDOW: TestChatWindow = {
  phase: { kind: "closed" },
  collapsed: false,
  contexts: [],
  offset: ZERO_OFFSET,
  shape: DEFAULT_TEST_CHAT_SHAPE,
};

function pluginOf(phase: TestChatPhase): string | null {
  return phase.kind === "closed" ? null : phase.plugin;
}

export function reduceTestChat(state: TestChatWindow, event: TestChatEvent): TestChatWindow {
  switch (event.type) {
    case "opening":
      // 새로 열면 펼친다. 이미 떠 있던 창은 자리를 지킨다(옮긴 거리 유지)
      return {
        ...state,
        phase: { kind: "opening", plugin: event.plugin },
        collapsed: false,
        contexts: event.contexts,
        offset: state.phase.kind === "closed" ? ZERO_OFFSET : state.offset,
      };
    case "opened":
      // 닫은 뒤 늦게 온 답은 창을 다시 열지 않는다
      if (state.phase.kind !== "opening") return state;
      return { ...state, phase: { kind: "ready", threadId: event.threadId, plugin: event.plugin } };
    case "failed":
      if (state.phase.kind !== "opening") return state;
      return {
        ...state,
        phase: { kind: "failed", plugin: pluginOf(state.phase), error: event.error },
      };
    case "collapse":
      return state.phase.kind === "closed" ? state : { ...state, collapsed: event.collapsed };
    case "close":
      return { ...CLOSED_WINDOW, shape: state.shape };
    case "move":
      return { ...state, offset: event.offset };
    case "shape":
      return { ...state, shape: event.shape, offset: ZERO_OFFSET };
    default:
      return assertNever(event, "TestChatEvent");
  }
}

let current: TestChatWindow = CLOSED_WINDOW;
const listeners = new Set<() => void>();

export function dispatchTestChat(event: TestChatEvent): void {
  const next = reduceTestChat(current, event);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function snapshot(): TestChatWindow {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTestChatWindow(): TestChatWindow {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
