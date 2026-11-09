// 성능 측정(P-20, §6.27). 열린 대화의 최근 Turn을 고르면 Turn 다시 보기로 내려간다.
import { t } from "@fresnel/client/i18n";
import { Select, SelectOption } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId, useRecentTurnIds } from "../../state/engine/index.ts";
import { PanelExpandButton } from "../shell/screen-header.tsx";
import { tabLinkOf } from "../workbench/tab-read.ts";
import { loadPerf } from "./perf-read.ts";
import { PerfView } from "./perf-view.tsx";
import { SectionTitle } from "./measure-parts.tsx";
import { useMeasureRead } from "./measure-read.ts";
import { PromotionView } from "./promotion-view.tsx";
import { TurnReview } from "./turn-screen.tsx";

export function MetricsScreen(): ReactNode {
  const link = tabLinkOf(useLinkPhase());
  const threadId = useOpenThreadId();
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
      <div className="mx-auto flex w-full max-w-240 items-center gap-1 px-3 pt-6 pb-4">
        <PanelExpandButton />
        <h1 className="m-0 text-text-primary">{t("desktop.measure.title")}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-240 gap-5 px-3 pb-6">
          <PerfView read={perf} onOpenTurn={setPicked} />
          <PromotionView read={promotion} />
          {threadId === null || turnId === null ? null : (
            // 고르기는 구역 머리 오른쪽의 Select(sm)다. 대화의 Turn이 많아도 한 줄을 넘지 않는다
            <section className="grid gap-4">
              <SectionTitle
                title={t("desktop.measure.pickTurn")}
                actions={
                  <Select
                    size="sm"
                    variant="soft"
                    aria-label={t("desktop.measure.pickTurn")}
                    value={turnId}
                    onValueChange={setPicked}
                    className="w-64 max-w-full"
                  >
                    {newestFirst.map((id) => (
                      <SelectOption key={id} value={id}>
                        {id}
                      </SelectOption>
                    ))}
                  </Select>
                }
              />
              <TurnReview threadId={threadId} turnId={turnId} link={link} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
