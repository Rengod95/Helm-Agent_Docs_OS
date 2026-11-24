// 플러그인 상세 "구성" 탭의 캔버스(plugHead, AGE-76 "루프상에서 어느지점에서 어떤식으로 동작하는건지"). 머리줄과 탭 고르기 아래 내용 칸 전체를 채운다.
// 가운데 줄은 엔진 블록 모델의 지점(대화 시작 → 입력 받기 → 컨텍스트 조립 → 모델 호출 → 도구 실행, 사람에게 묻기, 서브에이전트 → 턴 종료 직전)이고,
// 도구 쪽 세 블록은 모델이 부를 때만 지나며 끝나면 결과를 들고 다음 단계의 컨텍스트 조립으로 돌아간다(위의 호). 기록은 턴 내내 듣는 띠다.
// 이 플러그인이 넣는 것(재료)은 줄 위 카드에서 그 블록으로, Hook은 블록 앞뒤 문(마름모)이나 경계에서 아래 카드로, Drive는 맨 아래 넓은 카드와
// 그 단계(누르면 단계가 끼어드는 문이 밝아진다)로 그린다. 무엇을 누르든 떠 있는 설명 판(`loop-panel.tsx`)이 그것을 사람 말로 설명한다.
// 색은 종류 색 토큰 그대로다(Inject cobalt, 도구 초록, Hook 노랑, Drive 보라).
import { t } from "@fresnel/client/i18n";
import { ZoomControl } from "@caustic/react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { KindTag, kindSolid } from "../../workbench/plugin-kind.tsx";
import { CANVAS_BLEED } from "../../workbench/detail-rail.ts";
import {
  feedTarget,
  gateSpotsOf,
  isCalled,
  loopLayoutOf,
  spotPoint,
  FEED_SHOWN,
  type LoopLayout,
  type Rect,
} from "./loop-layout.ts";
import {
  isBoundary,
  pickedSpotsOf,
  hookLinesOf,
  pointOfSpot,
  spotKey,
  usedPointsOf,
  type FeedPoint,
  type LoopPick,
  type LoopPlan,
  type PointId,
} from "./loop-model.ts";
import { FEED_WORD, POINT_WORD, POWER_WORD, spotWord } from "./loop-text.ts";

/** 맞춤 배율의 아래 한계(DP-49: 글이 읽히는 크기 밑으로 줄이지 않고 스크롤한다) */
const MIN_SCALE = 0.75;
const PAD_X = 32;
const PAD_TOP = 24;
/** 아래 여백은 왼쪽 아래 줌 캡슐(아래 16 + 높이 약 36) 위로 마지막 카드가 올라오게 넉넉히 둔다 */
const PAD_BOTTOM = 72;
/** 판이 아래에 설 때 그림과 판 사이(space-6), 판 아래 여백(space-4, 확대 단추와 같은 줄) */
const PANEL_GAP = 24;
const PANEL_BOTTOM = 16;
/** 판을 아래에 둘 수 있는 가장 낮은 높이. 이보다 낮으면 오른쪽 위에 세운다 */
const PANEL_MIN_H = 220;

/** 캔버스 바깥 칸의 모양: 점 바탕(판 밑까지 이어진다)과, 판이 아래에 설 때 판의 가장 큰 높이(그림 아래 남은 높이). 판 쪽 클래스가 이 변수를 읽는다 */
type RoomStyle = CSSProperties & { readonly "--loop-panel-room": string };

function roomStyle(room: number): RoomStyle {
  return {
    "--loop-panel-room": `${room}px`,
    backgroundImage: "radial-gradient(var(--cs-color-canvas-dot) 1px, transparent 1.2px)",
    backgroundSize: "24px 24px",
  };
}

/** 그림 좌표 사각형의 절대 자리 */
function at(rect: Rect): { left: number; top: number; width: number; height: number } {
  return { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
}

/** 재료 카드의 종류: 도구 블록에 넣는 것은 도구, 나머지는 Inject */
function feedKind(point: FeedPoint): "inject" | "tool" {
  return point === "tools" ? "tool" : "inject";
}

const HOOK_COLOR = kindSolid("hook");
const DRIVE_COLOR = kindSolid("drive");

/** 선, 호, 문(마름모). 글과 단추는 그 위 층의 HTML이다 */
function Wires(props: {
  readonly plan: LoopPlan;
  readonly layout: LoopLayout;
  readonly lit: ReadonlySet<string>;
  readonly pick: LoopPick | null;
}): ReactNode {
  const { layout, plan } = props;
  const rail = [...layout.points.entries()];
  const picked = props.pick;
  const stepLines =
    picked?.kind === "step"
      ? (layout.drive?.steps.find((box) => box.step.row.id === picked.id) ?? null)
      : null;
  return (
    <svg
      aria-hidden
      width={layout.width}
      height={layout.height}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
    >
      <defs>
        <marker
          id="loop-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L8 4 L0 8 Z" fill="var(--cs-color-border-strong)" />
        </marker>
      </defs>
      {/* 루프 줄: 지점 사이 화살표 */}
      {rail.slice(0, -1).map(([id, rect], index) => {
        const next = rail[index + 1];
        if (next === undefined) return null;
        return (
          <line
            key={id}
            x1={rect.x + rect.w}
            x2={next[1].x - 2}
            y1={layout.railY}
            y2={layout.railY}
            stroke="var(--cs-color-border-strong)"
            strokeWidth={1.5}
            markerEnd="url(#loop-arrow)"
          />
        );
      })}
      {/* 다음 단계로 돌아가는 호 */}
      <path
        d={`M${layout.arc.fromX} ${layout.arc.railTop} V${layout.arc.topY + 8} Q${layout.arc.fromX} ${layout.arc.topY} ${layout.arc.fromX - 8} ${layout.arc.topY} H${layout.arc.toX + 8} Q${layout.arc.toX} ${layout.arc.topY} ${layout.arc.toX} ${layout.arc.topY + 8} V${layout.arc.railTop - 2}`}
        fill="none"
        stroke="var(--cs-color-border-strong)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
        markerEnd="url(#loop-arrow)"
      />
      {/* 재료 선: 카드 아래에서 블록 위로 */}
      {layout.feeds.map((box) => {
        const to = feedTarget(layout, box.feed.point);
        if (to === null) return null;
        const fromX = box.rect.x + box.rect.w / 2;
        const fromY = box.rect.y + box.rect.h;
        const midY = (fromY + layout.arc.topY) / 2;
        return (
          <path
            key={box.feed.point}
            d={`M${fromX} ${fromY} V${midY} H${to.x} V${to.y - 2}`}
            fill="none"
            stroke={kindSolid(feedKind(box.feed.point))}
            strokeWidth={2}
          />
        );
      })}
      {/* Hook 선: 문이나 경계에서 아래 카드로(기록 구독은 카드에서 아래 기록 띠로) */}
      {layout.hooks.map((box) => {
        if (box.anchor === null) return null;
        const cardX = box.rect.x + box.rect.w / 2;
        const toRecord = box.spot.kind === "on" && box.spot.point === "record";
        const d = toRecord
          ? `M${cardX} ${box.rect.y + box.rect.h} V${box.anchor.y}`
          : `M${box.anchor.x} ${box.anchor.y + 8} V${box.rect.y - 16} H${cardX} V${box.rect.y}`;
        return (
          <path
            key={spotKey(box.spot)}
            d={d}
            fill="none"
            stroke={HOOK_COLOR}
            strokeWidth={props.lit.has(spotKey(box.spot)) ? 3 : 2}
            strokeDasharray={toRecord ? "4 4" : undefined}
          />
        );
      })}
      {/* 고른 Drive 단계의 선: 단계 칸에서 그 단계가 끼어드는 문으로 */}
      {stepLines === null
        ? null
        : stepLines.step.spots.map((spot) => {
            const to = spotPoint(layout, spot);
            if (to === null) return null;
            const fromX = stepLines.rect.x + stepLines.rect.w / 2;
            return (
              <path
                key={spotKey(spot)}
                d={`M${fromX} ${stepLines.rect.y} V${layout.record.y + layout.record.h + 12} H${to.x} V${to.y + 8}`}
                fill="none"
                stroke={DRIVE_COLOR}
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            );
          })}
      {/* 문: 이 플러그인의 Hook이나 Drive 단계가 끼어드는 블록 앞뒤 */}
      {gateSpotsOf(plan).map((spot) => {
        const p = spotPoint(layout, spot);
        if (p === null) return null;
        const lit = props.lit.has(spotKey(spot));
        const size = lit ? 8 : 6;
        const hooked = plan.hooks.some((hook) =>
          hook.spots.some((s) => spotKey(s) === spotKey(spot)),
        );
        return (
          <path
            key={spotKey(spot)}
            d={`M${p.x} ${p.y - size} L${p.x + size} ${p.y} L${p.x} ${p.y + size} L${p.x - size} ${p.y} Z`}
            fill={hooked ? HOOK_COLOR : DRIVE_COLOR}
            stroke="var(--cs-color-bg-app)"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

/** 줄 위 지점 하나(경계는 알약, 블록은 둥근 상자. 모델이 부를 때만 지나는 블록은 점선) */
function PointNode(props: {
  readonly point: PointId;
  readonly rect: Rect;
  readonly used: boolean;
  readonly picked: boolean;
  readonly onPick: () => void;
}): ReactNode {
  const boundary = isBoundary(props.point);
  return (
    <button
      type="button"
      data-loop-point={props.point}
      aria-pressed={props.picked}
      onClick={(e) => {
        e.stopPropagation();
        props.onPick();
      }}
      className={[
        "absolute flex items-center justify-center border px-2 text-center text-ui-strong outline-none transition-control focus-visible:shadow-focus",
        boundary ? "rounded-full" : "rounded-lg",
        isCalled(props.point) ? "border-dashed" : "border-solid",
        props.picked
          ? "border-text-primary bg-surface-raised text-text-primary"
          : props.used
            ? "border-border-strong bg-surface-base text-text-primary hover:bg-surface-raised"
            : "border-border-default bg-surface-base text-text-tertiary hover:text-text-secondary",
      ].join(" ")}
      style={at(props.rect)}
    >
      <span className="line-clamp-2">{t(POINT_WORD[props.point])}</span>
    </button>
  );
}

/** 카드 머리: 종류 꼬리표와 제목 한 줄 */
function CardHead(props: {
  readonly kind: "inject" | "tool" | "hook" | "drive";
  readonly title: string;
}): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <KindTag kind={props.kind} />
      <span className="min-w-0 truncate text-ui-strong text-text-primary">{props.title}</span>
    </span>
  );
}

/** 카드 상자의 겉(무채색 면, 고르면 잉크 테두리) */
function cardClass(picked: boolean): string {
  return `absolute flex flex-col overflow-hidden rounded-xl border bg-surface-base ${
    picked ? "border-text-primary" : "border-border-default"
  }`;
}

export function LoopCanvas(props: {
  readonly plan: LoopPlan;
  readonly pick: LoopPick | null;
  readonly onPick: (pick: LoopPick | null) => void;
  /** 떠 있는 설명 판. 캔버스 위 오른쪽 위에 선다 */
  readonly panel: ReactNode;
  /** 판이 펼쳐져 있나. 판이 오른쪽 위에 서면 그림은 판 왼쪽 자리에 맞추고 그 자리 안에서만 스크롤한다 */
  readonly panelOpen: boolean;
}): ReactNode {
  const { plan, pick, panelOpen } = props;
  const layout = useMemo(() => loopLayoutOf(plan), [plan]);
  const used = useMemo(() => usedPointsOf(plan), [plan]);
  const lit = useMemo(() => new Set(pickedSpotsOf(plan, pick).map(spotKey)), [plan, pick]);
  const litPoints = new Set(
    pickedSpotsOf(plan, pick)
      .map(pointOfSpot)
      .filter((point): point is PointId => point !== null),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  /** 펼친 판이 캔버스 오른쪽에서 차지하는 폭(판 왼쪽 끝부터 캔버스 오른쪽 끝까지). 판이 오른쪽 위에 서면 스크롤 칸이 그만큼 짧아져 그림이 판 밑으로 들어가지 않는다. 판이 아래에 있거나 접혔으면 0 */
  const [reserve, setReserve] = useState(0);
  /** 판의 자리: 그림 아래에 판이 들어갈 높이가 남으면 아래(그림은 폭 전체), 아니면 오른쪽 위(그림은 판 왼쪽 폭에 맞춘다) */
  const [panelAt, setPanelAt] = useState<{ readonly at: "bottom" | "end"; readonly room: number }>({
    at: "end",
    room: 0,
  });
  useEffect(() => {
    const el = ref.current;
    const root = rootRef.current;
    if (el === null || root === null) return undefined;
    const update = (): void => {
      const fitIn = (width: number): number =>
        Math.max(
          MIN_SCALE,
          Math.min(
            1,
            width / layout.width,
            (root.clientHeight - PAD_TOP - PAD_BOTTOM) / layout.height,
          ),
        );
      const full = fitIn(root.clientWidth - PAD_X * 2);
      const below = root.clientHeight - PAD_TOP - layout.height * full - PANEL_GAP - PANEL_BOTTOM;
      if (!panelOpen || below >= PANEL_MIN_H) {
        setPanelAt({ at: "bottom", room: Math.max(0, below) });
        setReserve(0);
        setFit(full);
        return;
      }
      const panel = root.querySelector("[data-loop-panel-body]");
      const room =
        panel === null
          ? 0
          : Math.max(0, root.getBoundingClientRect().right - panel.getBoundingClientRect().left);
      setPanelAt({ at: "end", room: 0 });
      setReserve(room);
      setFit(fitIn(root.clientWidth - PAD_X * 2 - room));
    };
    update();
    // 스크롤 칸은 판 자리만큼 줄어들므로 바깥 칸의 크기를 본다(줄어든 폭이 다시 맞춤을 부르지 않게)
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [layout, panelOpen]);
  const scale = zoom ?? fit;
  // 다음 단계 호의 글은 모델 호출 위에 둔다. 모델 호출에는 위에서 들어오는 재료 선이 없어 글이 선을 끊지 않는다
  const modelAt = layout.points.get("model");
  const arcLabelX =
    modelAt === undefined ? (layout.arc.fromX + layout.arc.toX) / 2 : modelAt.x + modelAt.w / 2;
  const pickPoint = (point: PointId): void => {
    props.onPick({ kind: "point", point });
  };
  return (
    <div
      ref={rootRef}
      data-panel-at={panelAt.at}
      className={`group/loop relative min-h-0 flex-1 ${CANVAS_BLEED} [--graph-plate:var(--cs-color-bg-app)]`}
      style={roomStyle(panelAt.room)}
      role="group"
      aria-label={t("desktop.craft.loop.label")}
    >
      {/* 바탕을 누르면 고른 것을 풀고 설명 판은 요약으로 돌아간다 */}
      <div
        ref={ref}
        className="absolute inset-y-0 start-0 overflow-auto"
        style={{ insetInlineEnd: reserve }}
        onClick={() => {
          props.onPick(null);
        }}
      >
        <div
          style={{
            width: layout.width * scale + PAD_X * 2,
            height: layout.height * scale + PAD_TOP + PAD_BOTTOM,
            paddingInlineStart: PAD_X,
            paddingTop: PAD_TOP,
          }}
        >
          <div
            className="relative"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
            }}
          >
            <Wires plan={plan} layout={layout} lit={lit} pick={pick} />
            {/* 다음 단계 호의 글 */}
            <span
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg-app px-2 text-ui-sm whitespace-nowrap text-text-tertiary"
              style={{ left: arcLabelX, top: layout.arc.topY }}
            >
              {t("desktop.craft.loop.again")}
            </span>
            {[...layout.points.entries()].map(([point, rect]) => (
              <PointNode
                key={point}
                point={point}
                rect={rect}
                used={used.has(point)}
                picked={(pick?.kind === "point" && pick.point === point) || litPoints.has(point)}
                onPick={() => {
                  pickPoint(point);
                }}
              />
            ))}
            {layout.feeds.map((box) => {
              const picked = pick?.kind === "feed" && pick.point === box.feed.point;
              const more = box.feed.items.length - FEED_SHOWN;
              return (
                <button
                  key={box.feed.point}
                  type="button"
                  aria-pressed={picked}
                  className={`${cardClass(picked)} gap-1 px-3 py-2 text-start outline-none focus-visible:shadow-focus`}
                  style={at(box.rect)}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onPick({ kind: "feed", point: box.feed.point });
                  }}
                >
                  <CardHead kind={feedKind(box.feed.point)} title={t(FEED_WORD[box.feed.point])} />
                  {box.feed.items.slice(0, FEED_SHOWN).map((item) => (
                    <span
                      key={`${item.kind}:${item.name}`}
                      className="truncate font-mono text-ui-sm text-text-secondary"
                    >
                      {item.name}
                    </span>
                  ))}
                  {more > 0 && (
                    <span className="text-ui-sm text-text-tertiary">
                      {t("desktop.craft.loop.more", { count: more })}
                    </span>
                  )}
                </button>
              );
            })}
            {layout.hooks.map((box) => (
              <div
                key={spotKey(box.spot)}
                className={`${cardClass(lit.has(spotKey(box.spot)))} px-1 pb-1`}
                style={at(box.rect)}
              >
                <span className="flex h-10 flex-none items-center px-2">
                  <CardHead kind="hook" title={t(spotWord(box.spot))} />
                </span>
                {hookLinesOf(box.hooks).map((line) => {
                  const first = line.hooks[0];
                  if (first === undefined) return null;
                  const picked =
                    pick?.kind === "hook" && line.hooks.some((hook) => hook.name === pick.name);
                  return (
                    <button
                      key={first.name}
                      type="button"
                      aria-pressed={picked}
                      className={`flex h-8 min-w-0 flex-none items-center gap-2 rounded-md px-2 text-start outline-none focus-visible:shadow-focus ${
                        picked ? "bg-neutral-selected" : "hover:bg-neutral-hover"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onPick({ kind: "hook", name: first.name });
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-ui text-text-primary">
                        {line.power === null ? first.name : t(POWER_WORD[line.power])}
                      </span>
                      {line.hooks.length > 1 ? (
                        <span className="flex-none text-ui-sm tabular-nums text-text-tertiary">
                          {t("desktop.craft.loop.count", { count: line.hooks.length })}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
            {/* 기록 띠: 턴 내내 일어난 일을 남기는 블록 */}
            <button
              type="button"
              data-loop-point="record"
              aria-pressed={pick?.kind === "point" && pick.point === "record"}
              className={`absolute flex items-center gap-3 rounded-lg border border-dashed px-4 text-start outline-none focus-visible:shadow-focus ${
                (pick?.kind === "point" && pick.point === "record") || litPoints.has("record")
                  ? "border-text-primary bg-surface-raised"
                  : used.has("record")
                    ? "border-border-strong bg-surface-base hover:bg-surface-raised"
                    : "border-border-default bg-surface-base"
              }`}
              style={at(layout.record)}
              onClick={(e) => {
                e.stopPropagation();
                pickPoint("record");
              }}
            >
              <span
                className={`text-ui-strong ${used.has("record") ? "text-text-primary" : "text-text-tertiary"}`}
              >
                {t(POINT_WORD.record)}
              </span>
              <span className="truncate text-ui-sm text-text-tertiary">
                {t("desktop.craft.loop.record.all")}
              </span>
            </button>
            {layout.drive === null ? null : (
              <div
                className={cardClass(pick?.kind === "drive")}
                style={{
                  ...at(layout.drive.rect),
                  borderColor: pick?.kind === "drive" ? undefined : DRIVE_COLOR,
                }}
              >
                <button
                  type="button"
                  aria-pressed={pick?.kind === "drive"}
                  className="flex h-14 flex-none items-center gap-3 px-4 text-start outline-none focus-visible:shadow-focus"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onPick({ kind: "drive" });
                  }}
                >
                  <CardHead
                    kind="drive"
                    title={t("desktop.craft.canvas.cv3.fact.changes.holdsTurn")}
                  />
                  {plan.drive?.commands.map((command) => (
                    <span key={command} className="font-mono text-ui-sm text-text-secondary">
                      {command}
                    </span>
                  ))}
                </button>
                {/* 단계 자리는 Drive 상자의 바깥 테두리 기준이다. 1px 테두리만큼 바깥으로 낸 칸에 놓아 배치 값과 정확히 맞춘다 */}
                <div className="pointer-events-none absolute -inset-px">
                  {layout.drive.steps.map((box, index) => {
                    const picked = pick?.kind === "step" && pick.id === box.step.row.id;
                    return (
                      <button
                        key={box.step.row.id}
                        type="button"
                        aria-pressed={picked}
                        className={`pointer-events-auto absolute flex items-center gap-2 rounded-md border px-2 text-start outline-none focus-visible:shadow-focus ${
                          picked
                            ? "border-text-primary bg-surface-raised"
                            : "border-border-default bg-surface-base hover:bg-surface-raised"
                        }`}
                        style={{
                          left: box.rect.x - (layout.drive?.rect.x ?? 0),
                          top: box.rect.y - (layout.drive?.rect.y ?? 0),
                          width: box.rect.w,
                          height: box.rect.h,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onPick({ kind: "step", id: box.step.row.id });
                        }}
                      >
                        <span className="flex-none text-ui-sm tabular-nums text-text-tertiary">
                          {index + 1}
                        </span>
                        <span className="min-w-0 truncate text-ui text-text-primary">
                          {box.step.row.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute start-8 bottom-4 flex items-end">
        <ZoomControl
          className="pointer-events-auto"
          size="sm"
          value={`${Math.round(scale * 100)}%`}
          label={t("desktop.craft.composition.zoom.label")}
          zoomOutLabel={t("desktop.craft.composition.zoom.out")}
          zoomInLabel={t("desktop.craft.composition.zoom.in")}
          onZoomOut={() => {
            setZoom(Math.max(0.5, scale - 0.1));
          }}
          onZoomIn={() => {
            setZoom(Math.min(1.6, scale + 0.1));
          }}
          onReadoutClick={() => {
            setZoom(null);
          }}
        />
      </div>
      {props.panel}
    </div>
  );
}
