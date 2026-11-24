import { Button } from "@caustic/react";
import { MessageSquare } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, parse, rethrow } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import { useEffect, useState, type ReactNode } from "react";
import { trialThreadFromTests } from "../authoring-row-model.ts";
import { useCommands } from "../commands.ts";
import { useShowChat } from "../plugin/plugin-view.tsx";

// 시험 실행 도구 줄의 "테스트 대화 열기"(AGE-77 W-02). 시험 대화는 사이드바에 없으므로 그 줄에서 바로 연다.
// 폴더를 고르지 않는다: 시험이 이미 연 대화를 고르고 화면 자리를 대화로 돌린다(테스트 화면의 "대화 열기"와 같은 길).

/**
 * 도구 결과가 대화 id를 줬으면 그 id로, 확인 카드만 남았으면(모델이 승인 뒤 다시 부르지 않은 흐름) 테스트 목록에서
 * 이 호출 뒤에 열린 시험 대화를 찾는다. 부르는 쪽이 승인과 턴 끝마다 `key`를 바꿔 다시 마운트하므로 그때 목록을 다시 읽는다
 */
export function TrialChatLink(props: {
  readonly threadId: string | null;
  readonly sinceMs: number;
}): ReactNode {
  const commands = useCommands();
  const showChat = useShowChat();
  const [found, setFound] = useState<string | null>(null);
  const known = props.threadId !== null;
  const { sinceMs } = props;
  useEffect(() => {
    if (known) return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const listed = await commands.tests.list();
      if (active && listed.ok) setFound(trialThreadFromTests(listed.value, sinceMs));
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, known, sinceMs]);
  const raw = props.threadId ?? found;
  if (raw === null) return null;
  const id = parse(ThreadIdSchema, raw);
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
