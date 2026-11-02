// 내비 "구조"(옛 개요·런타임 지도): 보기 셋 [그림 | 층 | 표]. 머리 아래에 보기 기준 한 줄, 바꾸기 미리보기 띠, 실패 Alert.
import { Alert, Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { Eye, RotateCcw, SlidersHorizontal } from "../../_shell";
import { WorkbenchHead, useShell } from "../../_shell";
import { PLUGINS, PRESET_DIFF, relationsOf, viewOf } from "../data";
import { Fit } from "../parts/kit";
import { useMock } from "../store";
import { BAND_W, FocusBar, LayerWorld, bandsFor, worldH, type WorldMode } from "./layer-world";
import { MatrixView } from "./matrix";
import { LayerStackCard, LifecycleHero, StageCard } from "./overview";
import { AddL1Sheet, ExplainOverlay } from "./overlays";

/** 보기 기준 한 줄(보기)과 바꾸기 미리보기 띠(바꾸기)를 다른 모양으로: 보기 = 눈 + 회색 글, 바꾸기 = accent 면 + 동작. */
function ViewLine() {
  const m = useMock();
  const v = viewOf(m.view);
  if (m.preview !== null) {
    const p = viewOf(m.preview);
    const n = Object.values(PRESET_DIFF);
    return (
      <div className="grid gap-1.5 pb-2">
        <div className="flex items-center gap-1.5 text-ui-xs text-text-tertiary [&_svg]:size-3.5">
          <Eye />
          <span>
            보는 중 · 대화 <span className="text-text-secondary">{v.label}</span> · 아직 그대로예요
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-accent-soft px-3 py-2 [&_svg]:size-4">
          <span className="flex items-center gap-1.5 text-ui-sm text-accent-text">
            <SlidersHorizontal />
            프로필 "{p.label}"을 이 대화에 적용하면
          </span>
          <span className="flex flex-wrap items-center gap-2 text-ui-xs text-text-primary">
            <span>
              <b className="font-mono text-diff-add-text">+</b> 켜짐{" "}
              {n.filter((x) => x.mark === "add").length}
            </span>
            <span>
              <b className="font-mono text-diff-remove-text">−</b> 꺼짐{" "}
              {n.filter((x) => x.mark === "remove").length}
            </span>
            <span>
              <b className="font-mono text-agent-text">~</b> 설정{" "}
              {n.filter((x) => x.mark === "override").length}
            </span>
            <span className="text-text-secondary">주도 그대로 · 이번 단계가 끝나면 적용</span>
          </span>
          <span className="flex-1" />
          <span className="flex gap-1">
            <Button size="xs" variant="ghost" onClick={() => m.set({ screen: "diff" })}>
              나란히 비교
            </Button>
            <Button size="xs" variant="ghost" onClick={() => m.set({ preview: null })}>
              닫기
            </Button>
            <Button
              size="xs"
              variant="solid"
              onClick={() => m.notify("이번 단계가 끝나면 적용돼요")}
            >
              이 대화에 적용
            </Button>
          </span>
        </div>
      </div>
    );
  }
  return null;
}

export function StructureScreen() {
  const m = useMock();
  const shell = useShell();
  const view = m.screen === "overview" ? "picture" : m.screen === "matrix" ? "table" : "layers";
  const v = viewOf(m.view);
  const mine = PLUGINS.filter((p) => p.origin !== "builtin").length;
  const mode: WorldMode =
    m.overlay === "add-l1"
      ? "add"
      : m.focus !== null
        ? "focus"
        : m.preview !== null
          ? "preview"
          : m.failure
            ? "failure"
            : v.kind === "thread"
              ? "thread"
              : "normal";
  const wide = shell.layout === "wide";
  const compact = shell.layout === "compact";
  const col = m.overlay === "add-l1" ? 0 : wide ? 232 : mode === "focus" ? 200 : 96;
  const sub =
    v.kind === "thread" ? (
      <>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-success-solid" />
          대화 {v.label}
        </span>
        <span>실시간 · 턴 7 · 켜짐 {22} · 진행 Helm</span>
      </>
    ) : (
      <>
        <span>설치 전체</span>
        <span>켜짐·꺼짐은 대화마다 달라요 · 14:03 기준</span>
      </>
    );
  const legend = (
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <span
          className="inline-block h-2.5 w-3.5 rounded-sm"
          style={{ boxShadow: "inset 0 0 0 1.25px var(--h-L3)" }}
        />
        색 테두리 = 내 것
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block h-2.5 w-3.5 rounded-sm"
          style={{ border: "1.25px dashed var(--edge-strong)" }}
        />
        점선 = 더할 자리
      </span>
    </span>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkbenchHead
        className="w-full px-3"
        title="구조"
        meta={`플러그인 ${PLUGINS.length} · 내 것 ${mine} · 자동 꺼짐 1`}
        sub={
          view === "layers" ? (
            <>
              {sub}
              {legend}
            </>
          ) : (
            sub
          )
        }
        actions={
          <>
            {view === "layers" && !compact && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => m.notify("층 안 순서를 자동 배치로 되돌렸어요")}
                aria-label="자동 배치로 되돌리기"
              >
                <RotateCcw />
              </Button>
            )}
            <SegmentedControl
              size="xs"
              aria-label="보기"
              value={view}
              onValueChange={(x) =>
                m.set({
                  screen: x === "picture" ? "overview" : x === "table" ? "matrix" : "layers",
                  focus: null,
                  overlay: null,
                })
              }
            >
              <SegmentedControlItem value="picture">그림</SegmentedControlItem>
              <SegmentedControlItem value="layers">층</SegmentedControlItem>
              <SegmentedControlItem value="table">표</SegmentedControlItem>
            </SegmentedControl>
          </>
        }
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-3">
        <ViewLine />
        {m.failure && view === "layers" && (
          <Alert
            tone="danger"
            size="sm"
            className="mb-2"
            actions={[
              { label: "리뷰 다시 켜기", onClick: () => m.notify("이번 단계가 끝나면 다시 켜요") },
              { label: "훅 기록 보기", onClick: () => m.notify("기록 탭을 열어요") },
            ]}
          >
            실패 3 · 리뷰가 연속 5번 실패해 자동으로 꺼졌어요. 내 훅 시크릿 검사는 출력 위반
            3번이에요(열린 채 통과).
          </Alert>
        )}
        {view === "picture" &&
          (compact ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex h-[300px]">
                <LifecycleHero />
              </div>
              {m.stage !== null && (
                <div className="mb-4">
                  <StageCard id={m.stage} />
                </div>
              )}
              <LayerStackCard compact />
            </div>
          ) : (
            <div className={`flex min-h-0 flex-1 gap-4 ${wide ? "" : "flex-col overflow-auto"}`}>
              <div className={`flex min-h-0 min-w-0 ${wide ? "flex-1" : "h-[420px] flex-none"}`}>
                <LifecycleHero />
              </div>
              <div
                className={`grid content-start gap-4 ${wide ? "w-[300px] flex-none overflow-auto" : ""}`}
              >
                {m.stage !== null && <StageCard id={m.stage} />}
                <LayerStackCard compact />
              </div>
            </div>
          ))}
        {view === "layers" &&
          (compact ? (
            <CompactLayers />
          ) : (
            <div
              className={`flex min-h-0 min-w-0 flex-1 flex-col ${m.overlay === "add-l1" ? "pe-[372px]" : ""}`}
            >
              {mode === "focus" && m.focus !== null && <FocusBar focusId={m.focus} />}
              <Fit
                w={(col > 0 ? col + 12 : 0) + BAND_W}
                h={worldH(
                  bandsFor(mode === "focus" && m.focus !== null ? relationsOf(m.focus) : []),
                )}
                min={0.66}
                max={1.1}
              >
                <LayerWorld mode={mode} col={col} focusId={m.focus} />
              </Fit>
            </div>
          ))}
        {view === "table" && <MatrixView />}
        {m.overlay === "explain" && <ExplainOverlay />}
        {m.overlay === "add-l1" && <AddL1Sheet />}
      </div>
    </div>
  );
}

/** 700px: 캔버스 대신 층 목록(층마다 내장·내 것·더하기). */
function CompactLayers() {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <LayerStackCard compact />
    </div>
  );
}
