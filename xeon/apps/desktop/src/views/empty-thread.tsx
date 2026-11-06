import { EmptyState, Suggestions, SuggestionsItem } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { useCommands } from "./commands.ts";

// 빈 대화 안내(시안 `p02-opus/stage.tsx` EmptyThread). 제안 칩은 입력창에 글을 채우기만 하고 보내지 않는다(`requestComposer`: 입력 중인 글이 있으면 채우지 않고 초점만 준다)

/** 제안 칩 글. 시안 문구 그대로다 */
export const EMPTY_THREAD_SUGGESTIONS: readonly MessageId[] = [
  "desktop.emptyThread.suggest.structure",
  "desktop.emptyThread.suggest.failingTests",
  "desktop.emptyThread.suggest.recentChanges",
];

export function EmptyThread(): ReactNode {
  const commands = useCommands();
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-auto">
      <div className="mx-auto grid w-full max-w-184 gap-4 px-3 pb-3">
        <EmptyState
          variant="agent"
          surface="none"
          size="sm"
          title={t("desktop.emptyThread.prompt")}
        />
        <Suggestions aria-label={t("desktop.emptyThread.suggest.label")} variant="outline">
          {EMPTY_THREAD_SUGGESTIONS.map((id) => (
            <SuggestionsItem
              key={id}
              onClick={() => {
                commands.requestComposer(t(id));
              }}
            >
              {t(id)}
            </SuggestionsItem>
          ))}
        </Suggestions>
      </div>
    </div>
  );
}
