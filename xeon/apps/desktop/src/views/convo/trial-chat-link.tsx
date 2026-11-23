import { Button } from "@caustic/react";
import { MessageSquare } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import type { ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { useShowChat } from "../plugin/plugin-view.tsx";

// 시험 실행 도구 줄의 "테스트 대화 열기"(AGE-77 W-02). 시험 대화는 사이드바에 없으므로 그 줄에서 바로 연다.
// 폴더를 고르지 않는다: 시험이 이미 연 대화를 고르고 화면 자리를 대화로 돌린다(테스트 화면의 "대화 열기"와 같은 길).

export function TrialChatLink(props: { readonly threadId: string }): ReactNode {
  const commands = useCommands();
  const showChat = useShowChat();
  const id = parse(ThreadIdSchema, props.threadId);
  if (!id.ok) return null;
  const threadId = id.value;
  return (
    <div className="flex">
      <Button
        size="xs"
        variant="ghost"
        iconStart={<MessageSquare aria-hidden />}
        onClick={() => {
          commands.selectThread(threadId);
          showChat();
        }}
      >
        {t("desktop.convo.tool.openTrialChat")}
      </Button>
    </div>
  );
}
