// 런타임 지도(작업대 "개요"): 머리 한 줄 + (실패 Alert | 차이 띠) + 나눔 보기(목록 | 캔버스). 캔버스는 세 줌 단계(개요·층·상세)를
// 줌 사다리로 오가고, "구조 살펴보기"가 다섯 단계 둘러보기를 연다. 표 보기는 층 × 지점 행렬. 좁은 폭(compact)은 목록만.
import { Alert, Button, IconButton, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { Compass, Diamond, RotateCcw, ZoomIn, ZoomOut } from "../../_shell";
import { WorkbenchHead, useShell } from "../../_shell";
import { ctxOf } from "../data";
import { useMock, type Zoom } from "../store";
import { ListPane } from "../parts/list-pane";
import { Viewport } from "../parts/kit";
import { TOUR, TourOverlay } from "../parts/tour";
import { Detail, DW } from "./detail";
import { LayerMap } from "./layer";
import { LW } from "../data";
import { Matrix } from "./matrix";
import { OW, Overview } from "./overview";

const ZOOMS: { id: Zoom; label: string }[] = [
  { id: "overview", label: "개요" },
  { id: "layer", label: "층" },
  { id: "detail", label: "상세" },
];

function ZoomLadder() {
  const m = useMock();
  const i = ZOOMS.findIndex((z) => z.id === m.zoom);
  const go = (n: number) => {
    const z = ZOOMS[Math.max(0, Math.min(2, n))]!.id;
    m.set({ zoom: z, selected: z === "detail" ? (m.selected ?? "helm") : m.selected });
  };
  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-xl bg-surface-raised p-1 shadow-3">
      <IconButton
        size="sm"
        variant="ghost"
        label="줄이기"
        onClick={() => go(i - 1)}
        disabled={i === 0}
      >
        <ZoomOut />
      </IconButton>
      <SegmentedControl
        size="xs"
        aria-label="줌 단계"
        value={m.zoom}
        onValueChange={(v) => go(ZOOMS.findIndex((z) => z.id === v))}
      >
        {ZOOMS.map((z) => (
          <SegmentedControlItem key={z.id} value={z.id}>
            {z.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <IconButton
        size="sm"
        variant="ghost"
        label="키우기"
        onClick={() => go(i + 1)}
        disabled={i === 2}
      >
        <ZoomIn />
      </IconButton>
      {m.zoom === "layer" && (
        <IconButton
          size="sm"
          variant="ghost"
          label="자동 배치로 되돌리기"
          onClick={() => m.notify("층마다 자동 배치로 되돌렸어요")}
        >
          <RotateCcw />
        </IconButton>
      )}
    </div>
  );
}

export function MapScreen() {
  const m = useMock();
  const shell = useShell();
  const compact = shell.layout === "compact";
  const tourStep = m.tour !== null ? TOUR[m.tour] : undefined;
  const zoom: Zoom = tourStep?.zoom ?? m.zoom;
  const ctx = ctxOf(tourStep?.ctx ?? m.ctx);
  const world = zoom === "overview" ? OW : zoom === "layer" ? LW : DW;
  const overlay =
    m.tour !== null ? (
      <TourOverlay
        step={m.tour}
        w={world.w}
        h={world.h}
        onStep={(n) => m.set({ tour: n, ...(TOUR[n]?.ctx ? { ctx: TOUR[n]!.ctx } : {}) })}
        onClose={() => m.set({ tour: null })}
      />
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkbenchHead
        className="w-full px-3"
        title="런타임 지도"
        meta={
          ctx.kind === "all"
            ? "확장 11 · 켜짐 8 · 자동 꺼짐 1"
            : `${ctx.label} · 켜짐 8 · drive helm`
        }
        sub={
          ctx.kind === "thread" ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success-solid" /> 실시간 · 턴 7 · 14:03 기준
            </span>
          ) : (
            "설치된 확장 전부 · 임대는 대화마다 따로예요 · 14:03 기준"
          )
        }
        actions={
          <span className="flex items-center gap-1.5">
            {!compact && m.mapView === "canvas" && (
              <Button
                size="xs"
                variant={m.tour !== null ? "soft" : "ghost"}
                iconStart={<Compass />}
                onClick={() => m.set({ tour: m.tour === null ? 0 : null })}
              >
                구조 살펴보기
              </Button>
            )}
            <SegmentedControl
              size="xs"
              aria-label="보기"
              value={m.mapView}
              onValueChange={(v) => m.set({ mapView: v as "canvas" | "matrix" })}
            >
              <SegmentedControlItem value="canvas">지도</SegmentedControlItem>
              <SegmentedControlItem value="matrix">표</SegmentedControlItem>
            </SegmentedControl>
          </span>
        }
      />
      {m.failure && (
        <div className="px-3 pt-1 pb-2">
          <Alert
            tone="danger"
            size="sm"
            emphasis="lead"
            actions={[
              {
                label: "다시 켜기",
                primary: true,
                onClick: () => m.notify("다음 단계 경계에 다시 켜져요"),
              },
              { label: "기록 보기", onClick: () => shell.openEnd("log") },
            ]}
          >
            <b>리뷰가 자동으로 꺼졌어요.</b> boundary.settle.after에서 5번 연속 시간 초과 · acme
            노트는 예외 2번(거부로 처리)
          </Alert>
        </div>
      )}
      {m.diff && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-raised px-3 py-2 text-ui-sm shadow-1">
          <span className="text-text-secondary">
            프로필 <b className="font-medium text-text-primary">탐구 중심</b>을 이 대화에 적용하면
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="grid size-4 place-items-center rounded-full bg-diff-add-bg text-ui-xs text-diff-add-text">
              +
            </span>
            대화 도구
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="grid size-4 place-items-center rounded-full bg-diff-remove-bg text-ui-xs text-diff-remove-text">
              −
            </span>
            계획 먼저
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="grid size-4 place-items-center rounded-full bg-agent-soft text-ui-xs text-agent-text">
              ~
            </span>
            Helm 렌즈 3 → 4
          </span>
          <span className="text-text-tertiary">drive 그대로 helm</span>
          <span className="inline-flex items-center gap-1 text-text-tertiary [&_svg]:size-3">
            <Diamond /> 다음 단계 경계에 적용
          </span>
          <span className="ms-auto flex gap-1">
            <Button size="xs" variant="ghost" onClick={() => m.set({ diff: false })}>
              닫기
            </Button>
            <Button
              size="xs"
              variant="solid"
              tone="accent"
              onClick={() => m.notify("다음 단계 경계에 적용돼요")}
            >
              이 대화에 적용
            </Button>
          </span>
        </div>
      )}
      {m.mapView === "matrix" ? (
        <Matrix />
      ) : compact ? (
        <div className="min-h-0 flex-1 overflow-y-auto ps-3 pe-16 pb-4">
          <ListPane wide />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 ps-3 pb-1">
          {shell.layout === "wide" && !shell.endOpen && <ListPane />}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <Viewport
              w={world.w}
              h={world.h}
              label={`런타임 지도 · ${ZOOMS.find((z) => z.id === zoom)?.label}`}
              max={1.1}
            >
              {zoom === "overview" && <Overview spot={m.tour !== null ? "loop" : null} />}
              {zoom === "layer" && <LayerMap />}
              {zoom === "detail" && <Detail />}
              {overlay}
            </Viewport>
            {m.tour === null && <ZoomLadder />}
          </div>
        </div>
      )}
    </div>
  );
}
