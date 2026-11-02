// 구성기 입구의 적용 화면(§6.28.3). 구성기 프로필 보기 그대로이고, 되돌아오면 고르던 값이 그대로 남아 그 자리에서 고쳐 다시 적용한다.
// 실패한 줄이 첫 화면에 보여야 해서 격자를 먼저, 실효 스택을 뒤에 둔다(wb-compose와 순서가 다르다, NOTES 참고).
// 실패한 줄은 "적용 뒤" 칸에 원인을 적고, 그 줄의 고르기를 바꾸면 표지가 사라진다. wb-compose ProfileStack의 Compare와 같은 격자이고 데이터도 거기서 온다.
import {
  Alert,
  Button,
  Select,
  SelectOption,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import {
  ArrowRight,
  ITEM_GAP,
  LineGridBlock,
  LineGridCell,
  LineGridFrame,
  LineGridMetric,
  PageBody,
  PageSection,
  T,
  threads,
  useShell,
  WorkbenchHead,
  josa,
} from "../../_shell";
import { stackBands, type Pick, type StackItem } from "../../wb-compose/fixtures";
import { PLUGINS } from "../../wb-v3/data";
import { FAIL_ID, type Phase } from "../flow";

const NOW: Record<StackItem["now"], string> = {
  enabled: "켜짐",
  disabled: "꺼짐",
  auto_disabled: T.autoDisabled,
};
const PICKS: readonly Pick[] = ["on", "off", "keep"];
const isPick = (v: string): v is Pick => PICKS.some((p) => p === v);

const BAND_TITLE: Record<string, string> = {
  X: T.xHook,
  L3: T.group,
  plugin: T.plugin,
  L2: T.capability,
  L1: T.layerL1,
};

/** 구성기 fixture는 기계 이름이다. 구조 화면과 같은 이름으로 보이게 표시 이름으로 바꾼다. */
const ALIAS: Record<string, string> = { "core-loop": "loop" };
const shown = (name: string) => PLUGINS.find((p) => p.id === (ALIAS[name] ?? name))?.name ?? name;

/** 실패하는 확장을 코어 층에 더한다. fixture의 다른 줄은 켜지는 것이 없어 실패할 일이 없다. */
const BANDS = stackBands.map((b) =>
  b.layer === "L1"
    ? {
        ...b,
        items: [
          {
            name: FAIL_ID,
            kind: "plugin" as const,
            tier: "user" as const,
            now: "disabled" as const,
            pick: "on" as const,
          },
          ...b.items,
        ],
      }
    : b,
);
const ALL = BANDS.flatMap((b) => b.items);

export const pickOf = (picks: Record<string, Pick>, it: StackItem): Pick =>
  picks[it.name] ?? it.pick;
export const composeWillFail = (picks: Record<string, Pick>) => (picks[FAIL_ID] ?? "on") === "on";

const after = (it: StackItem, p: Pick) =>
  p === "on" ? "켜짐" : p === "off" ? "꺼짐" : NOW[it.now];

const COLUMNS = "7.5rem minmax(0,1fr) 5.5rem 10rem 11rem";

function Head({ children }: { children: string }) {
  return (
    <LineGridCell head density="compact" role="columnheader">
      <span className="text-title-3 text-text-primary">{children}</span>
    </LineGridCell>
  );
}

function ItemCells({
  it,
  pick,
  phase,
  onPick,
}: {
  it: StackItem;
  pick: Pick;
  phase: Phase;
  onPick: (p: Pick) => void;
}) {
  const next = after(it, pick);
  const changes = next !== NOW[it.now];
  const failed = phase === "reverted" && it.name === FAIL_ID && pick === "on";
  const locked = phase === "pending" || phase === "done";
  return (
    <>
      <LineGridCell role="rowheader" density="compact">
        <span className="block truncate">{shown(it.name)}</span>
      </LineGridCell>
      <LineGridCell role="cell" density="compact">
        <span className="text-text-secondary">{phase === "done" ? next : NOW[it.now]}</span>
      </LineGridCell>
      <LineGridCell role="cell" density="compact" className="py-2.5">
        {it.locked !== undefined ? (
          <span className="text-ui-xs text-text-tertiary">{it.locked}</span>
        ) : (
          <SegmentedControl
            size="xs"
            value={pick}
            disabled={locked}
            onValueChange={(v) => {
              if (isPick(v)) onPick(v);
            }}
            aria-label={`${shown(it.name)} ${T.profile} 값`}
          >
            <SegmentedControlItem value="on">켜기</SegmentedControlItem>
            <SegmentedControlItem value="off">끄기</SegmentedControlItem>
            <SegmentedControlItem value="keep">그대로</SegmentedControlItem>
          </SegmentedControl>
        )}
      </LineGridCell>
      <LineGridCell role="cell" density="compact" selected={changes || failed}>
        {failed ? (
          <span className="flex items-baseline gap-2 text-danger-text">
            <span
              aria-hidden
              className="size-1.5 flex-none translate-y-[-1px] rounded-full bg-danger-graphic"
            />
            {T.capabilityWait}
          </span>
        ) : (
          <span className={changes ? "font-medium text-text-primary" : "text-text-tertiary"}>
            {next}
          </span>
        )}
      </LineGridCell>
    </>
  );
}

export function ComposeHead() {
  return (
    <WorkbenchHead
      className="w-full px-3"
      title={T.compose}
      actions={
        <span className="flex items-center gap-2">
          <Select size="xs" defaultValue="explore" aria-label={T.profile} className="w-40">
            <SelectOption value="explore">탐구 중심</SelectOption>
            <SelectOption value="quiet">조용히</SelectOption>
          </Select>
          <SegmentedControl size="xs" value="profile" aria-label={`${T.compose} 보기`}>
            <SegmentedControlItem value="group">{T.group}</SegmentedControlItem>
            <SegmentedControlItem value="flow">{T.flow}</SegmentedControlItem>
            <SegmentedControlItem value="profile">{T.profile}</SegmentedControlItem>
            <SegmentedControlItem value="code">코드</SegmentedControlItem>
          </SegmentedControl>
        </span>
      }
    />
  );
}

export function ComposeBody({
  phase,
  picks,
  onPick,
  onApply,
  onGoThread,
  onTrial,
  onSave,
}: {
  phase: Phase;
  picks: Record<string, Pick>;
  onPick: (name: string, p: Pick) => void;
  onApply: () => void;
  onGoThread: () => void;
  onTrial: () => void;
  onSave: () => void;
}) {
  const shell = useShell();
  const ctx = threads.find((t) => t.id === shell.contextThreadId)?.title ?? "";
  const changed = ALL.filter((i) => after(i, pickOf(picks, i)) !== NOW[i.now]);
  const description =
    phase === "pending"
      ? T.atBoundary
      : phase === "done"
        ? `${ctx}에 적용했어요`
        : phase === "reverted"
          ? `${ctx}는 전과 같아요`
          : `${ctx}에 적용하면`;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PageBody>
        {phase === "reverted" && (
          <div className="px-3">
            <Alert tone="danger" variant="soft" size="sm">
              {`${josa(shown(FAIL_ID), "을", "를")} 켜지 못해 ${T.profile} 값을 모두 되돌렸어요.`}
            </Alert>
          </div>
        )}
        <PageSection
          headInset="px-3"
          title={`${T.profile} 쌓기`}
          action={
            <span className={`flex flex-wrap items-center ${ITEM_GAP}`}>
              <Button size="sm" variant="outline" onClick={onSave} disabled={phase === "pending"}>
                저장
              </Button>
              <Button size="sm" variant="outline" onClick={onTrial} disabled={phase === "pending"}>
                {T.trialThread}로
              </Button>
              {phase === "done" ? (
                <Button size="sm" variant="solid" onClick={onGoThread}>
                  {T.thread}로 가기
                </Button>
              ) : (
                <Button size="sm" variant="solid" loading={phase === "pending"} onClick={onApply}>
                  {phase === "reverted" ? "다시 적용" : T.applyToThread}
                </Button>
              )}
            </span>
          }
        >
          <LineGridFrame>
            <LineGridBlock
              role="table"
              aria-label={`${T.profile} 값 견주기`}
              columns={COLUMNS}
              style={{ minWidth: "40rem" }}
            >
              <div role="row" className="contents">
                <Head>{T.layer}</Head>
                <Head>{T.extension}</Head>
                <Head>지금</Head>
                <Head>{T.profile}</Head>
                <Head>적용 뒤</Head>
              </div>
              {BANDS.flatMap((b) =>
                b.items.map((it, i) => (
                  <div key={it.name} role="row" className="contents">
                    {i === 0 && (
                      <LineGridCell
                        head
                        density="compact"
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
                      pick={pickOf(picks, it)}
                      phase={phase}
                      onPick={(p) => onPick(it.name, p)}
                    />
                  </div>
                )),
              )}
            </LineGridBlock>
          </LineGridFrame>
        </PageSection>
        <PageSection headInset="px-3" title={T.effectiveStack} description={description}>
          <LineGridFrame>
            <LineGridBlock columns={3}>
              <LineGridMetric
                density="compact"
                value={changed.length}
                metricLabel={phase === "done" ? `바뀐 ${T.extension}` : `바뀌는 ${T.extension}`}
              />
              <LineGridMetric density="compact" value="Helm" metricLabel={T.lead} />
              <LineGridMetric
                density="compact"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-text-tertiary">3</span>
                    <ArrowRight aria-hidden className="size-icon-sm text-text-tertiary" />4
                  </span>
                }
                metricLabel={`${T.lens} 수`}
              />
            </LineGridBlock>
          </LineGridFrame>
        </PageSection>
      </PageBody>
    </div>
  );
}
