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
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
      <h1 className="text-ui-strong text-text-primary">{t("desktop.measure.title")}</h1>
      <PerfView read={perf} onOpenTurn={setPicked} />
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
  );
}
