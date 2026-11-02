// W7 측정과 평가(P-20): 기간 SegmentedControl, 요약 줄, 확장별 지표 표, 핸들러 시간/예산 막대, 승격 보고, 코어 변경 검사 요약.
// 맥락(전체·대화 하나)은 왼쪽 패널 맥락 칸이 정한다(§4.9.3). 화면 머리에 맥락 Select를 두지 않는다(스펙 와이어프레임과 다름, NOTES).
import { Alert, Badge, Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { CircleCheck, ToneIcon, useShell } from "../../_shell";
import { BudgetMeter, MiniBars } from "../parts/budget-meter";
import { ExtCell } from "../parts/ext-cell";
import { GridTable, type GridColumn } from "../parts/grid-table";
import { ScreenHead, SectionTitle, WB_WIDTH } from "../parts/screen-head";
import { diffCheck, handlerTimes, metrics, metricsScale, promotion } from "../fixtures";
import { useMock, type Period } from "../store";

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : `${Math.round(n / 1000)}k`;
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

type Row = (typeof metrics)[number] & { id: string };

export function MetricsScreen() {
  const m = useMock();
  const ctxOn = useShell().contextThreadId !== null;
  const k = (metricsScale[m.period] ?? 1) * (ctxOn ? 0.32 : 1);
  const off = m.instrumentationOff;
  const rows: Row[] = metrics.map((r) => ({
    ...r,
    id: r.name,
    tokens: Math.round(r.tokens * k),
    costUsd: r.costUsd * k,
    leaseMin: Math.round(r.leaseMin * k),
    failures: Math.round(r.failures * Math.min(1, k * 1.4)),
    denies: Math.round(r.denies * k),
  }));
  const dash = (v: string) => (off ? <span className="text-text-tertiary">–</span> : v);
  const cols: GridColumn<Row>[] = [
    { key: "name", header: "확장", cell: (r) => <ExtCell name={r.name} link={false} /> },
    {
      key: "tokens",
      header: "토큰",
      width: "5.5rem",
      align: "end",
      cell: (r) => dash(fmtTokens(r.tokens)),
    },
    {
      key: "cost",
      header: "비용",
      width: "5rem",
      align: "end",
      cell: (r) => dash(`$${r.costUsd.toFixed(2)}`),
    },
    {
      key: "lease",
      header: "주도",
      width: "4.5rem",
      align: "end",
      cell: (r) => dash(r.leaseMin === 0 ? "-" : `${r.leaseMin}분`),
    },
    {
      key: "fail",
      header: "실패",
      width: "4rem",
      align: "end",
      cell: (r) =>
        off ? (
          dash("")
        ) : (
          <span className={r.failures > 0 ? "text-text-primary" : "text-text-tertiary"}>
            {r.failures}
          </span>
        ),
    },
    {
      key: "deny",
      header: "거부",
      width: "4rem",
      align: "end",
      cell: (r) => dash(String(r.denies)),
    },
    {
      key: "trend",
      header: "추세",
      width: "4rem",
      align: "end",
      hideCompact: true,
      cell: (r) => (off ? dash("") : <MiniBars values={r.trend} />),
    },
  ];

  const total = rows.reduce(
    (a, r) => ({
      cost: a.cost + r.costUsd,
      tokens: a.tokens + r.tokens,
      lease: a.lease + r.leaseMin,
      fail: a.fail + r.failures,
    }),
    { cost: 0, tokens: 0, lease: 0, fail: 0 },
  );
  const handlers = handlerTimes.map((h, i) => ({ ...h, id: `h${i}` }));
  type H = (typeof handlers)[number];
  const hCols: GridColumn<H>[] = [
    {
      key: "where",
      header: "확장 · 훅",
      cell: (h) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-text-primary">{h.ext}</span>
          <span className="truncate text-text-secondary">{h.point}</span>
        </span>
      ),
    },
    {
      key: "p95",
      header: "p95 / 예산",
      width: "8rem",
      align: "end",
      cell: (h) => (
        <span>
          {fmtMs(h.p95Ms)} <span className="text-text-tertiary">/ {fmtMs(h.budgetMs)}</span>
        </span>
      ),
    },
    {
      key: "bar",
      header: <span className="sr-only">예산 대비</span>,
      width: "30%",
      cell: (h) => (
        <BudgetMeter value={h.p95Ms} max={h.budgetMs} label={`${h.ext} ${h.point} p95 예산 대비`} />
      ),
    },
  ];

  const cands = promotion.candidates.map((c) => ({ ...c, id: c.tool }));
  type C = (typeof cands)[number];
  const cCols: GridColumn<C>[] = [
    {
      key: "tool",
      header: "도구",
      cell: (c) => <span className="font-mono text-mono-sm">{c.tool}</span>,
    },
    { key: "owner", header: "소유", width: "7rem", cell: (c) => c.owner },
    {
      key: "consumers",
      header: "다른 scope 사용",
      cell: (c) => c.consumers.map((x) => `${x.scope} ${x.calls}번`).join(", "),
    },
    {
      key: "user",
      header: "사용자 호출",
      width: "6rem",
      align: "end",
      hideCompact: true,
      cell: (c) => c.userCalls,
    },
    {
      key: "verdict",
      header: "판정",
      width: "5rem",
      cell: (c) =>
        c.candidate ? (
          <Badge size="xs" tone="info">
            승격 후보
          </Badge>
        ) : (
          "-"
        ),
    },
  ];

  const periodLabel = { "1d": "1일", "7d": "7일", "30d": "30일" }[m.period];
  return (
    <>
      <ScreenHead
        title="측정과 평가"
        asOf={`${periodLabel} · ${ctxOn ? "대화 1개" : `대화 ${promotion.threads}개`} · throughSeq ${promotion.throughSeq} · 14:05 기준`}
        actions={
          <SegmentedControl
            size="xs"
            value={m.period}
            onValueChange={(v) => m.set({ period: v as Period })}
            aria-label="기간"
          >
            <SegmentedControlItem value="1d">1일</SegmentedControlItem>
            <SegmentedControlItem value="7d">7일</SegmentedControlItem>
            <SegmentedControlItem value="30d">30일</SegmentedControlItem>
          </SegmentedControl>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} grid gap-5 pb-6`}>
          {/* 요약: 표면 없는 숫자 넷. CardStat은 카드 면이라 투명한 가운데(DP-01, DP-26)와 맞지 않아 글자로만 둔다. */}
          <dl className="m-0 grid grid-cols-4 gap-3 px-2 max-[700px]:grid-cols-2">
            {[
              ["비용", off ? "–" : `$${total.cost.toFixed(2)}`],
              ["토큰", off ? "–" : fmtTokens(total.tokens)],
              ["주도 시간", off ? "–" : `${total.lease}분`],
              ["핸들러 실패", off ? "–" : String(total.fail)],
            ].map(([l, v]) => (
              <div key={l} className="grid gap-0.5">
                <dt className="text-ui-xs text-text-tertiary">{l}</dt>
                <dd className="m-0 text-ui-lg font-semibold tabular-nums text-text-primary">{v}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="m-ext">
            <SectionTitle id="m-ext" meta="행을 누르면 확장 상세 측정 탭">
              확장별
            </SectionTitle>
            {off && (
              <Alert
                tone="warning"
                variant="soft"
                size="sm"
                emphasis="lead"
                className="mb-2"
                actions={[
                  {
                    label: "계측 켜기",
                    onClick: () => m.notify("l3.group-sdk.instrumentation을 켰어요"),
                  },
                ]}
              >
                <b>계측이 꺼져 있어요.</b> 그룹 지표를 기록하지 않아 값이 없어요.{" "}
                <span className="font-mono text-mono-sm text-text-tertiary">
                  l3.group-sdk.instrumentation
                </span>
              </Alert>
            )}
            <GridTable
              label="확장별 지표"
              columns={cols}
              rows={rows}
              selectedId={null}
              onSelect={(id) => m.notify(`${id} 확장 상세 측정 탭으로 가요`)}
              rowLabel={(r) =>
                `${r.name}, 토큰 ${fmtTokens(r.tokens)}, 비용 ${r.costUsd.toFixed(2)}달러, 실패 ${r.failures}`
              }
            />
          </section>

          <section aria-labelledby="m-handler">
            <SectionTitle id="m-handler" meta="예산의 50%를 넘으면 경고 색">
              핸들러 시간
            </SectionTitle>
            {off ? (
              <p className="m-0 px-2 text-ui-dense text-text-tertiary">
                계측이 꺼져 있어 기록이 없어요
              </p>
            ) : (
              <GridTable label="핸들러 시간과 예산" columns={hCols} rows={handlers} />
            )}
          </section>

          <section aria-labelledby="m-promo">
            <SectionTitle
              id="m-promo"
              meta={`throughSeq ${promotion.throughSeq} · 대화 ${promotion.threads}개`}
            >
              승격 보고
            </SectionTitle>
            <GridTable label="승격 후보" columns={cCols} rows={cands} />
          </section>

          <section aria-labelledby="m-diff">
            <SectionTitle id="m-diff" meta={diffCheck.at}>
              코어 변경 검사
            </SectionTitle>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 text-ui-dense">
              <ToneIcon tone="success">
                <CircleCheck />
              </ToneIcon>
              <span className="font-mono text-mono-sm text-text-secondary">{diffCheck.range}</span>
              <span className="text-text-primary">보호 경로 0줄</span>
              <span className="text-text-tertiary">
                · 보호 밖 파일 {diffCheck.changedOutside}개
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => m.set({ screen: "tests", selectedTest: "t1" })}
                className="ms-auto"
              >
                테스트 실행에서 보기
              </Button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
