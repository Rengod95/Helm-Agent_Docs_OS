// 성능 측정(P-20, §6.27). 맥락 칸의 대화(없으면 열린 대화)의 최근 Turn을 고르면 Turn 다시 보기로 내려간다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { Button, EmptyState } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId, useRecentTurnIds } from "../../state/engine/index.ts";
import { useShell, type WorkbenchContext } from "../../state/shell/index.ts";
import { tabLinkOf } from "../workbench/tab-read.ts";
import { loadPerf } from "./perf-read.ts";
import { PerfView } from "./perf-view.tsx";
import { useMeasureRead } from "./measure-read.ts";
import { PromotionView } from "./promotion-view.tsx";
import { TurnReview } from "./turn-screen.tsx";

function threadOfContext(context: WorkbenchContext): string | null {
  switch (context.kind) {
    case "thread":
    case "trial":
      return context.threadId;
    case "all":
    case "profile":
      return null;
    default:
      return assertNever(context, "WorkbenchContext");
  }
}

export function MetricsScreen(): ReactNode {
  const link = tabLinkOf(useLinkPhase());
  const fromContext = threadOfContext(useShell((s) => s.context));
  const open = useOpenThreadId();
  const threadId = fromContext ?? open;
  const turns = useRecentTurnIds(threadId);
  const [picked, setPicked] = useState<string | null>(null);
  const newestFirst = turns.toReversed();
  const turnId =
    picked !== null && turns.some((id) => id === picked) ? picked : (newestFirst[0] ?? null);
  const perf = useMeasureRead(`perf:${threadId ?? ""}:${turns.join(",")}`, link, (commands) =>
    loadPerf(commands, threadId, turns),
  );
  const promotion = useMeasureRead(`promotion:${threadId ?? ""}`, link, (commands) =>
    commands.measure.promotion(threadId),
  );
  return (
    // 머리(제목)는 붙박이고 내용만 한 스크롤 컨테이너에서 흐른다. 내용은 시안 WB_WIDTH와 같은 가운데 폭(60rem, 좌우 여백 3)이다
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="mx-auto w-full max-w-240 px-3 pt-6 text-ui-strong text-text-primary">
        {t("desktop.measure.title")}
      </h1>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-240 gap-5 px-3 pb-6">
          <PerfView read={perf} onOpenTurn={setPicked} />
          <PromotionView read={promotion} />
          {threadId === null || turnId === null ? (
            <EmptyState title={t("desktop.measure.noTurns")} />
          ) : (
            <>
              <div
                className="flex flex-wrap gap-1"
                role="group"
                aria-label={t("desktop.measure.pickTurn")}
              >
                {newestFirst.map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={id === turnId ? "solid" : "outline"}
                    aria-pressed={id === turnId}
                    onClick={() => {
                      setPicked(id);
                    }}
                  >
                    {id}
                  </Button>
                ))}
              </div>
              <TurnReview threadId={threadId} turnId={turnId} link={link} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
