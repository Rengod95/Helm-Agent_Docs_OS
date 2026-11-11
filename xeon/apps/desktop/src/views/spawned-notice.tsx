import { Button } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { useOpenThread } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";

/**
 * 위임으로 만든 자식 대화(하위 에이전트, 엔진 내부 일)를 직접 열었을 때 입력창 자리에 보이는 줄.
 * 읽기만 하는 대화라 입력창은 없고 부모로 가는 단추만 둔다 [결정: 오케스트레이터 기본값, rtE R-3]
 */
export function SpawnedNotice(): ReactNode {
  const commands = useCommands();
  const thread = useOpenThread();
  const spawnedBy = thread?.spawnedBy;
  if (spawnedBy === undefined) return null;
  return (
    <div
      role="note"
      className="mx-auto flex w-full max-w-184 flex-none items-center gap-2 px-3 py-3 text-ui text-text-secondary"
    >
      <span className="min-w-0 flex-1">{t("desktop.chat.spawned.notice")}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          commands.selectThread(spawnedBy.threadId);
        }}
      >
        {t("desktop.chat.spawned.goParent")}
      </Button>
    </div>
  );
}
