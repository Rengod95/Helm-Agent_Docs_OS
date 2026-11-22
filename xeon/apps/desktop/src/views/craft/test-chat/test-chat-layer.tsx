// 테스트 챗 창의 자리. Craft 영역의 오른쪽 세로 단추 띠(`aside`)와 함께 늘 그려지는 부품(`EndTabDef.alwaysMounted`, 검사 탭)이라
// Craft 내비를 옮겨도 창이 남는다. 창은 띠의 `aside` 안에서 셸의 well과 같은 기준(띠 왼쪽)으로 선다.
// 창이 보이는 동안 창의 대화를 고른 대화로 빌리고(대화 화면의 부품이 고른 대화를 그린다), 창이 숨으면(닫기, 대화 영역으로 가기,
// 설정 열기) 빌리기 전의 대화로 돌려준다(`borrowNext`). 이 부품은 대화 영역에서 내려가므로 내려갈 때도 돌려준다.
import { useEffect, useRef, type ReactNode } from "react";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useShell } from "../../../state/shell/index.ts";
import { useScreen, useSelectedThreadId } from "../../../state/ui/index.ts";
import { useCommands, type Commands } from "../../commands.ts";
import { TestChatWindowView } from "./test-chat-window.tsx";
import { borrowNext, IDLE_BORROW, type Borrow } from "./window-model.ts";
import { useTestChatWindow } from "./window-state.ts";

/** 빌린 상태. 부품이 내려갔다 다시 서도 이어지도록 부품 밖에 둔다 */
let borrow: Borrow = IDLE_BORROW;

function step(commands: Commands, show: ThreadId | null, selected: ThreadId | null): void {
  const next = borrowNext(borrow, { show, selected });
  borrow = next.borrow;
  const action = next.action;
  if (action === null) return;
  if (action.kind === "select") commands.selectThread(action.thread);
  else commands.testChat.leave();
}

export function TestChatLayer(): ReactNode {
  const state = useTestChatWindow();
  const area = useShell((s) => s.area);
  const screen = useScreen();
  const selected = useSelectedThreadId();
  const commands = useCommands();
  const visible = area === "workbench" && screen !== "settings" && state.phase.kind !== "closed";
  const show = visible && state.phase.kind === "ready" ? state.phase.threadId : null;
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
    step(commands, show, selected);
  }, [commands, show, selected]);
  // 대화 영역으로 가면 이 부품이 내려간다. 그때 빌린 대화를 돌려준다
  useEffect(
    () => () => {
      step(commands, null, selectedRef.current);
    },
    [commands],
  );
  if (!visible) return null;
  return <TestChatWindowView state={state} />;
}
