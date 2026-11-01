// 작업대 개요 = 나눔 보기(결정 1): 왼쪽 목록 + 오른쪽 캔버스, 고름·올림이 양쪽으로 맞물린다. 오른쪽 well은 검사기.
// 좁은 창: 1100 이하(medium)는 목록을 접고(머리 버튼으로 다시), 720 이하(compact)는 목록만 보인다.
import { Alert, IconButton, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useEffect, useState } from "react";
import { LayoutGrid, PanelLeft, RotateCcw, Rows3, useShell, Compass } from "../../_shell";
import { COL, EXTS, LEASE, POST_Q, SOCKETS, WORLD, blockBox } from "../data";
import { ExtList } from "../parts/list";
import { RuntimeMap, THREAD_SHIFT } from "../parts/map";
import { Viewport, type MiniRect } from "../parts/viewport";
import { useMock } from "../store";

export function miniOfMap(selected: string | null): MiniRect[] {
  const r: MiniRect[] = (["A", "B", "C"] as const).map((k) => ({
    x: COL[k].x - 12,
    y: 0,
    w: COL[k].w + 24,
    h: 600,
    tone: "lane" as const,
  }));
  EXTS.forEach((e) => {
    const b = blockBox(e);
    r.push({
      ...b,
      tone: e.health === "danger" ? "danger" : selected === e.id ? "accent" : "base",
    });
  });
  SOCKETS.forEach((s) => r.push({ x: COL.C.x, y: s.y, w: COL.C.w, h: 28, tone: "base" }));
  r.push(
    { x: COL.C.x, y: POST_Q.y, w: COL.C.w, h: POST_Q.h },
    { x: COL.C.x, y: LEASE.y, w: COL.C.w, h: LEASE.h, tone: "strong" },
  );
  return r;
}

export function MapScreen() {
  const m = useMock();
  const shell = useShell();
  // well(검사기)이 열리면 1280에서 캔버스가 좁아지므로 목록은 접는다. 머리 버튼으로 다시 편다.
  const [listOpen, setListOpen] = useState(shell.layout === "wide" && !shell.endOpen);
  useEffect(() => {
    if (shell.endOpen) setListOpen(false);
  }, [shell.endOpen]);
  const thread = m.mapMode === "thread";
  const failure = m.mapMode === "failure";
  const select = (id: string | null) => {
    m.set({ selected: id });
    if (id !== null) shell.openEnd("inspect");
  };
  const list = (
    <ExtList
      selected={m.selected}
      hover={m.hover}
      thread={thread}
      compact={shell.layout === "compact"}
      onSelect={select}
      onHover={(h) => m.set({ hover: h })}
      onToggle={(id) => m.notify(`${id}: 다음 단계 경계에 적용돼요`)}
    />
  );
  const alert = failure ? (
    <Alert
      tone="danger"
      size="sm"
      emphasis="lead"
      className="mx-3 mt-2"
      actions={[
        {
          label: "다시 켜기",
          primary: true,
          onClick: () => m.notify("다음 단계 경계에 다시 켜져요"),
        },
        { label: "replay", onClick: () => m.notify("시험 실행에서 replay를 열어요") },
      ]}
    >
      <b>리뷰가 자동으로 꺼졌어요</b> boundary.settle.after 예산 5s를 연속 5번 넘겼어요 · acme 노트
      예외 2번은 거부로 처리됐어요
    </Alert>
  ) : null;

  if (shell.layout === "compact")
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pt-3">
        {alert}
        <div className="flex h-8 items-center gap-2">
          <span className="text-ui-sm text-text-primary">런타임 지도</span>
          <span className="text-ui-xs text-text-tertiary">확장 12 · 켜짐 10 · 자동 꺼짐 1</span>
        </div>
        <p className="text-ui-xs text-text-tertiary">
          좁은 창에서는 목록으로 보여요. 연결은 블록을 고르면 검사 탭에 있어요.
        </p>
        {list}
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {alert}
      <div className="flex min-h-0 flex-1 gap-1 ps-2 pt-1">
        {listOpen && <div className="flex min-h-0 flex-col pt-2 pb-3">{list}</div>}
        <Viewport
          label="런타임 지도"
          world={{ w: WORLD.w, h: WORLD.h + (thread ? THREAD_SHIFT + 12 : 0) }}
          pad={[56, 24 + (shell.endOpen && shell.layout === "wide" ? 360 : 0), 20, 28]}
          minK={shell.endOpen ? 0.74 : 0.82}
          maxK={1.05}
          anchor="start"
          onBackground={() => m.set({ selected: null })}
          crumbs={[
            {
              label: "런타임 지도",
              icon: <Compass className="size-3.5 text-text-tertiary" emphasis="muted" />,
            },
          ]}
          crumbMeta={thread ? "대화 맥락 · 턴 7" : "확장 12 · 켜짐 10 · 자동 꺼짐 1"}
          topRight={
            <>
              {!listOpen && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  className="glass glass-shadow-2"
                  label="목록 펴기"
                  onClick={() => setListOpen(true)}
                >
                  <PanelLeft />
                </IconButton>
              )}
              {listOpen && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  className="glass glass-shadow-2"
                  label="목록 접기"
                  onClick={() => setListOpen(false)}
                >
                  <PanelLeft emphasis="selected" />
                </IconButton>
              )}
              <IconButton
                size="sm"
                variant="ghost"
                className="glass glass-shadow-2"
                label="자동 배치로 되돌리기"
                onClick={() => m.notify("층마다 자동 배치로 되돌렸어요")}
              >
                <RotateCcw />
              </IconButton>
              <SegmentedControl
                aria-label="보기"
                size="sm"
                content="icon"
                value="map"
                onValueChange={(v) => v === "table" && m.set({ screen: "table" })}
                className="glass glass-shadow-2"
              >
                <SegmentedControlItem value="map" aria-label="지도" icon={<LayoutGrid />} />
                <SegmentedControlItem value="table" aria-label="층 × 지점 표" icon={<Rows3 />} />
              </SegmentedControl>
            </>
          }
          mini={miniOfMap(m.selected)}
        >
          <RuntimeMap
            selected={m.selected}
            hover={m.hover}
            mode={m.mapMode}
            onSelect={select}
            onHover={(h) => m.set({ hover: h })}
            onOpenGroup={(id) =>
              id === "helm"
                ? m.set({ screen: "group", selected: "helm" })
                : m.notify("이 그룹은 하위 캔버스 시안이 없어요")
            }
          />
        </Viewport>
      </div>
    </div>
  );
}
