// "구조 살펴보기" 둘러보기: 다섯 단계. 세계 위에 옅은 막(바탕색 72%)을 덮고 비춘 곳만 구멍을 내며 accent 테두리를 두른다.
// 설명 카드는 비춘 곳 옆 빈 자리에. 움직임은 꽂히는 블록(3단계) 하나뿐이고 reduced-motion에서 멈춘다.
import { Button } from "@caustic/react";
import { ChevronLeft, ChevronRight, X } from "../../_shell";
import type { Rect } from "./kit";
import type { Zoom } from "../store";

export interface TourStep {
  zoom: Zoom;
  title: string;
  body: string;
  spots: Rect[];
  card: { x: number; y: number };
  ctx?: string;
}

export const TOUR: TourStep[] = [
  {
    zoom: "overview",
    title: "가운데가 에이전트 루프예요",
    body: "대화의 한 턴은 이 고리를 한 바퀴 돌아요. 입력 → 요청 → 도구 → 단계 경계 순서로 지나가요.",
    spots: [{ x: 276, y: 158, w: 348, h: 340 }],
    card: { x: 594, y: 500 },
  },
  {
    zoom: "overview",
    title: "고리 위 홈이 소켓(훅)이에요",
    body: "훅 46개가 7종으로 묶여 있어요. 확장은 이 소켓에 핸들러를 꽂아 턴에 끼어들어요.",
    spots: [{ x: 276, y: 158, w: 348, h: 340 }],
    card: { x: 594, y: 500 },
  },
  {
    zoom: "layer",
    title: "설치하면 블록이 자기 층에 놓여요",
    body: "그룹이나 plugin을 설치하면 블록이 위층에 놓이고, 아래 핀이 매니페스트에 적힌 소켓에 꽂혀요. 소켓 밑 색 점이 꽂힌 블록이에요.",
    spots: [{ x: -6, y: -6, w: 912, h: 300 }],
    card: { x: 540, y: 330 },
  },
  {
    zoom: "layer",
    title: "그룹은 서비스의 기능을 불러 써요",
    body: "웹 검색, 지식, 작업 같은 기능은 아래층 서비스 블록이 내줘요. 꼭 필요한 기능이 없으면 그룹이 켜지지 않고, 선택 기능이 없으면 그 기능만 빠져요.",
    spots: [
      { x: -6, y: -6, w: 640, h: 140 },
      { x: -6, y: 340, w: 912, h: 126 },
    ],
    card: { x: 540, y: 160 },
  },
  {
    zoom: "layer",
    title: "대화마다 켜는 블록이 달라요",
    body: "파란 테두리 안이 이 대화에서 켜진 블록이에요. 켜고 끈 것은 다음 단계 경계에 적용되고, drive 자리는 한 그룹만 앉아요.",
    spots: [{ x: -6, y: -6, w: 912, h: 474 }],
    card: { x: 540, y: 486 },
    ctx: "t1",
  },
];

/** 세계 좌표 위 덮개. w·h는 세계 크기. */
export function TourOverlay({
  step,
  w,
  h,
  onStep,
  onClose,
}: {
  step: number;
  w: number;
  h: number;
  onStep: (n: number) => void;
  onClose: () => void;
}) {
  const s = TOUR[step]!;
  const rr = (r: Rect) =>
    `M${r.x + 16} ${r.y}h${r.w - 32}a16 16 0 0 1 16 16v${r.h - 32}a16 16 0 0 1 -16 16h${-(r.w - 32)}a16 16 0 0 1 -16 -16v${-(r.h - 32)}a16 16 0 0 1 16 -16z`;
  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute z-20"
        style={{ left: -40, top: -40 }}
        width={w + 80}
        height={h + 80}
      >
        <defs>
          <mask id="tour-hole" maskUnits="userSpaceOnUse">
            <rect x={0} y={0} width={w + 80} height={h + 80} fill="white" />
            <g transform="translate(40 40)">
              {s.spots.map((r, i) => (
                <path key={i} d={rr(r)} fill="black" />
              ))}
            </g>
          </mask>
        </defs>
        <rect
          x={0}
          y={0}
          width={w + 80}
          height={h + 80}
          fill="var(--cs-color-bg-app)"
          opacity={0.74}
          mask="url(#tour-hole)"
        />
        <g transform="translate(40 40)">
          {s.spots.map((r, i) => (
            <path
              key={i}
              d={rr(r)}
              fill="none"
              stroke="var(--cs-color-accent-solid)"
              strokeWidth={2}
              strokeDasharray="1 0"
              opacity={0.9}
            />
          ))}
        </g>
      </svg>
      <div
        role="dialog"
        aria-label="구조 살펴보기"
        className="absolute z-30 grid w-[300px] gap-2 rounded-2xl bg-surface-raised p-4 shadow-4"
        style={{ left: s.card.x, top: s.card.y }}
      >
        <div className="flex items-center gap-2">
          <span className="text-ui-xs text-accent-text tabular-nums">
            구조 살펴보기 · {step + 1}/{TOUR.length}
          </span>
          <button
            type="button"
            aria-label="둘러보기 닫기"
            onClick={onClose}
            className="ms-auto grid size-6 place-items-center rounded-md text-text-tertiary outline-none hover:bg-fill-hover focus-visible:focus-ring [&_svg]:size-3.5"
          >
            <X />
          </button>
        </div>
        <span className="text-ui-lg text-text-primary" style={{ fontWeight: 600 }}>
          {s.title}
        </span>
        <span className="text-ui text-text-secondary">{s.body}</span>
        <div className="mt-1 flex items-center gap-1.5">
          {TOUR.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? "w-4 bg-accent-solid" : "w-1.5 bg-neutral-track"}`}
            />
          ))}
          <span className="ms-auto flex gap-1">
            <Button
              size="xs"
              variant="ghost"
              disabled={step === 0}
              onClick={() => onStep(step - 1)}
              iconStart={<ChevronLeft />}
            >
              이전
            </Button>
            <Button
              size="xs"
              variant="solid"
              tone="accent"
              iconEnd={step < TOUR.length - 1 ? <ChevronRight /> : undefined}
              onClick={() => (step === TOUR.length - 1 ? onClose() : onStep(step + 1))}
            >
              {step === TOUR.length - 1 ? "끝" : "다음"}
            </Button>
          </span>
        </div>
      </div>
    </>
  );
}
