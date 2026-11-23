import { useEffect, type ReactNode } from "react";
import { useShellActions } from "../state/shell/index.ts";
import { ProposalsScreen } from "./pages/proposals/proposals-screen.tsx";
import { useSuggestState } from "./proposal-suggest.ts";

// 제안 화면의 문지기. 제안 플러그인이 꺼졌으면(알려진 꺼짐) 화면을 열어 두지 않고 대화 화면으로 돌아간다.
// 읽기 전(unknown)과 연결이 끊긴 때는 화면을 그대로 둔다: 읽기 전에 돌려보내지 않고, 끊긴 것은 화면이 스스로 알린다.

export function ProposalsGate(): ReactNode {
  const suggest = useSuggestState();
  const shell = useShellActions();
  useEffect(() => {
    if (suggest === "off") shell.updatePlace({ screen: "chat", scroll: 0 });
  }, [suggest, shell]);
  return suggest === "off" ? null : <ProposalsScreen />;
}
