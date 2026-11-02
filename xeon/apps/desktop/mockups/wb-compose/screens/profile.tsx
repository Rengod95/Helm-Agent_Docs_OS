// 프로필 쌓기(구성기 3): 지금 값과 프로필 값을 줄 맞춰 견주는 선 격자. 층 칸이 그 층의 확장 행을 묶고, 행마다 켜기·끄기·그대로
// (프로필 enable·disable·둘 다 아님, §6.28)를 고르면 "적용 뒤" 칸이 바뀐다. 위 "실효 스택"은 맥락 대화에 적용한 결과 요약이다.
// 순서가 뜻을 가지는 곳은 아래에 따로 둔다: 주도 칸(한 그룹 또는 자동)과 막기 훅의 핸들러 순서(런타임에 순서 입력이 없다).
// 적용은 다음 단계 경계.
import { Button, Chip, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useState } from "react";
import {
  ArrowRight,
  BAR_INSET,
  ITEM_GAP,
  GRID_INSET,
  LineGridBlock,
  LineGridCell,
  LineGridFrame,
  LineGridMetric,
  PageBody,
  PageSection,
  T,
  threads,
  useShell,
} from "../../_shell";
import { chainOrder, stackBands, type Pick, type StackItem } from "../fixtures";
import { useMock } from "../store";

const NOW: Record<StackItem["now"], string> = {
  enabled: "켜짐",
  disabled: "꺼짐",
  auto_disabled: T.autoDisabled,
};
const PICKS: Pick[] = ["on", "off", "keep"];
const isPick = (v: string): v is Pick => PICKS.some((p) => p === v);

const after = (it: StackItem, p: Pick) =>
  p === "on" ? "켜짐" : p === "off" ? "꺼짐" : NOW[it.now];

/** 층 이름: 용어표가 있는 것은 T로. */
const BAND_TITLE: Record<string, string> = { L3: T.group, L2: T.capability, plugin: T.plugin };

/** 층 · 확장 · 지금 · 프로필 · 적용 뒤. 프로필 칸은 SegmentedControl xs 폭에 맞춘다. */
const COMPARE_COLUMNS = "7.5rem minmax(0,1fr) 6rem 10rem 7rem";
const COMPARE_MIN_WIDTH = "42rem";

function ItemCells({ it, pick, onPick }: { it: StackItem; pick: Pick; onPick: (p: Pick) => void }) {
  const next = after(it, pick);
  const changes = next !== NOW[it.now];
  return (
    <>
      <LineGridCell role="rowheader">
        <span className="block truncate">{it.name}</span>
      </LineGridCell>
      <LineGridCell role="cell">
        <span className="text-text-secondary">{NOW[it.now]}</span>
      </LineGridCell>
      <LineGridCell role="cell" className="py-2.5">
        {it.locked !== undefined ? (
          <span className="text-footnote text-text-tertiary">{it.locked}</span>
        ) : (
          <SegmentedControl
            size="xs"
            value={pick}
            onValueChange={(v) => {
              if (isPick(v)) onPick(v);
            }}
            aria-label={`${it.name} ${T.profile} 값`}
          >
            <SegmentedControlItem value="on">켜기</SegmentedControlItem>
            <SegmentedControlItem value="off">끄기</SegmentedControlItem>
            <SegmentedControlItem value="keep">그대로</SegmentedControlItem>
          </SegmentedControl>
        )}
      </LineGridCell>
      <LineGridCell role="cell" selected={changes}>
        <span className={changes ? "font-medium text-text-primary" : "text-text-tertiary"}>
          {next}
        </span>
      </LineGridCell>
    </>
  );
}

function ColumnHeadCell({ children }: { children: string }) {
  return (
    <LineGridCell head role="columnheader">
      <span className="text-title-3 text-text-primary">{children}</span>
    </LineGridCell>
  );
}

function Compare({
  picks,
  onPick,
}: {
  picks: Record<string, Pick>;
  onPick: (name: string, p: Pick) => void;
}) {
  return (
    // 띠(LineGridFrame): 영역 양 끝까지 닿고 좁으면 가로로 스크롤한다. 칸 안쪽 여백은 regular(16)라 머리 px-4와 첫 열 글자가 줄을 맞춘다.
    <LineGridFrame>
      <LineGridBlock
        role="table"
        aria-label={`${T.profile} 값 견주기`}
        columns={COMPARE_COLUMNS}
        style={{ minWidth: COMPARE_MIN_WIDTH }}
      >
        <div role="row" className="contents">
          <ColumnHeadCell>{T.layer}</ColumnHeadCell>
          <ColumnHeadCell>{T.extension}</ColumnHeadCell>
          <ColumnHeadCell>지금</ColumnHeadCell>
          <ColumnHeadCell>{T.profile}</ColumnHeadCell>
          <ColumnHeadCell>적용 뒤</ColumnHeadCell>
        </div>
        {stackBands.flatMap((b) =>
          b.items.map((it, i) => (
            <div key={it.name} role="row" className="contents">
              {i === 0 && (
                <LineGridCell
                  head

                  role="rowheader"
                  aria-rowspan={b.items.length}
                  style={{ gridRow: `span ${b.items.length}` }}
                >
                  <span className="text-title-3 text-text-primary">
                    {BAND_TITLE[b.layer] ?? b.title}
                  </span>
                </LineGridCell>
              )}
              <ItemCells
                it={it}
                pick={picks[it.name] ?? "keep"}
                onPick={(p) => onPick(it.name, p)}
              />
            </div>
          )),
        )}
      </LineGridBlock>
    </LineGridFrame>
  );
}

const FromTo = ({ from, to }: { from: string; to: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="text-text-tertiary">{from}</span>
    <ArrowRight aria-hidden className="size-icon-sm text-text-tertiary" />
    {to}
  </span>
);

export function ProfileStack() {
  const m = useMock();
  const shell = useShell();
  const ctx = threads.find((t) => t.id === shell.contextThreadId)?.title ?? null;
  const all = stackBands.flatMap((b) => b.items);
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(all.map((i) => [i.name, i.pick])),
  );
  const changed = all.filter((i) => after(i, picks[i.name] ?? "keep") !== NOW[i.now]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PageBody>
        <PageSection
          headInset={`${GRID_INSET} ${BAR_INSET}`}
          title="실효 스택"
          description={ctx === null ? "대화를 고르면 계산해요" : `${ctx}에 적용하면`}
          action={
            <span className={`flex flex-wrap items-center ${ITEM_GAP}`}>
              <Button size="sm" variant="outline" onClick={() => m.notify("저장했어요")}>
                저장
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => m.notify("테스트 대화를 만들고 적용했어요")}
              >
                {T.trialThread}로
              </Button>
              <Button
                size="sm"
                variant="solid"
                disabled={ctx === null}
                onClick={() => m.notify("다음 단계 경계에 적용해요")}
              >
                이 대화에 적용
              </Button>
            </span>
          }
        >
          <LineGridFrame>
            <LineGridBlock columns={3}>
              <LineGridMetric value={changed.length} metricLabel={`바뀌는 ${T.extension}`} />
              <LineGridMetric value="helm" metricLabel={T.lead} />
              <LineGridMetric value={<FromTo from="3" to="4" />} metricLabel={`${T.lens} 수`} />
            </LineGridBlock>
          </LineGridFrame>
        </PageSection>

        <PageSection headInset={GRID_INSET} title={`${T.profile} 쌓기`}>
          <Compare picks={picks} onPick={(name, p) => setPicks((o) => ({ ...o, [name]: p }))} />
        </PageSection>

        <div className="border-t border-border-subtle">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-8 px-4 pt-8 max-[860px]:grid-cols-1">
            <PageSection level="group" title={T.lead}>
              <div className={`flex flex-wrap items-center ${ITEM_GAP}`}>
                <Chip variant="outline" size="md">
                  helm
                </Chip>
                <span className="text-footnote text-text-tertiary">후보</span>
                <Chip variant="outline" size="md" className="line-through opacity-60">
                  review
                </Chip>
              </div>
            </PageSection>

            <PageSection level="group" title="막기 순서">
              <div className={`flex flex-wrap items-center ${ITEM_GAP}`}>
                {chainOrder
                  .filter((t) => t.items.length > 0)
                  .map((t, i) => (
                    <span key={t.tier} className={`inline-flex items-center ${ITEM_GAP}`}>
                      {i > 0 && (
                        <ArrowRight aria-hidden className="size-icon-xs text-text-tertiary" />
                      )}
                      {t.items.map((n) => {
                        const removed = (t.removed ?? []).includes(n);
                        return (
                          <Chip
                            key={n}
                            variant="outline"
                            size="md"
                            className={removed ? "line-through opacity-60" : undefined}
                          >
                            {n}
                          </Chip>
                        );
                      })}
                    </span>
                  ))}
              </div>
            </PageSection>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
