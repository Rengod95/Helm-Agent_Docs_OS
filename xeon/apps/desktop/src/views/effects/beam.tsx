// beam 부품(DP-107·167 [결정: 2026-11-13 사용자]). 사용자가 고른 질감은 border-beam(MIT, libraries.dev)의 `line`이다: 가는 무지개 선과
// 그 안쪽으로 부드럽게 번지는 빛이 음성 녹음 이펙트처럼 살아 움직인다. 사용자는 그 빛이 돌지 않고 아래 변 전체 폭에 고정되기를 원했다(2026-11-13).
// - 머리 줄 아래(대화를 불러오는 중): 곧은 한 변이라 border-beam `line`을 그대로 쓴다(`BeamLine`).
// - 입력창·실행 중 칩: border-beam `line`은 78px 빛 한 점이 아래 변을 오가는 것이라 "아래 변 전체"가 되지 않는다. 그래서 그 결(빛깔·두 겹·숨)로
//   직접 만든 "아래 변 빛(edge glow)"이다: 1px 고리 마스크의 아래쪽(모서리 곡선이 시작하는 곳부터 끝까지)에 무지개가 흐르고, 그 위의 빛 알갱이들이
//   이웃끼리 다른 위상으로 세기와 자리를 바꾸며, 입력창은 같은 알갱이가 상자 안쪽으로 흐리게 번진다. 모두 transform·opacity 키프레임이라 합성기에서만 돈다.
// `BeamScope`는 감싼 내용 안에서 대상(`target`, 예: `.composer-box`)을 찾아 그 자리·반경·모서리 모양을 재고 그 위에 판을 겹친다.
// `BeamEdge`는 부모(실행 중 칩)의 아래 변에 선만 있는 작은 변형을 붙인다. 판은 누르기를 막지 않고 화면 낭독에서 빠진다.
// 승인 대기(wait)는 빛이 멈추고 아래 변이 경고 색으로 고정된다. 움직임을 줄이면 정지한 무지개 선이다. 꺼져 있으면 애니메이션이 없다(쉬는 동안 프레임 0).

import { BorderBeam } from "border-beam";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { isMotionReduced, useMotionReduced } from "../../lib/motion-presets.tsx";
import { GLOW_TUNE, LINE_TUNE, type GlowSpark, type GlowVariant } from "./fx-config.ts";
import { useFxScheme } from "./fx-scheme.ts";

export type BeamState = "off" | "run" | "wait";

/** 턴이 돌면 run, 그 대화에 승인을 기다리는 요청이 있으면(턴이 돌아도) wait, 그 밖에는 off */
export function beamStateOf(input: {
  readonly running: boolean;
  readonly awaitingApproval: boolean;
}): BeamState {
  if (input.awaitingApproval) return "wait";
  return input.running ? "run" : "off";
}

/** 판에 보일 모양. run은 살아 움직이는 빛, still은 움직임을 줄였을 때의 정지 선, wait는 경고 색 선 */
export type BeamLook = "off" | "run" | "still" | "wait";

export function beamLookOf(state: BeamState, reduced: boolean): BeamLook {
  if (state === "run") return reduced ? "still" : "run";
  return state;
}

type Box = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** 대상의 `corner-shape` 계산값. 판이 같은 모양을 쓴다 */
  readonly shape: string;
};

/** 대상 상자의 자리(감싼 판 기준), 모서리 반경과 모양. 반경을 읽지 못하면 16px, 모양이 없으면 round */
export function boxOf(scope: DOMRect, target: DOMRect, radius: string, shape = ""): Box {
  const parsed = Number.parseFloat(radius);
  const corner = shape.trim() === "" ? "round" : shape.trim();
  return {
    left: target.left - scope.left,
    top: target.top - scope.top,
    width: target.width,
    height: target.height,
    radius: Number.isFinite(parsed) ? parsed : 16,
    shape: corner,
  };
}

function sameBox(a: Box | null, b: Box): boolean {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.radius === b.radius &&
    a.shape === b.shape
  );
}

type SparkStyle = CSSProperties & {
  readonly "--x": string;
  readonly "--w": string;
  readonly "--c": string;
};

/** 알갱이 하나의 자리·폭·빛깔. 숨의 위상은 `data-phase`로 CSS가 고른다 */
function percent(share: number): string {
  return `${String(Math.round(share * 1000) / 10)}%`;
}

function sparkStyleOf(spark: GlowSpark): SparkStyle {
  return {
    "--x": percent(spark.at),
    "--w": percent(spark.width),
    "--c": `var(--fx-glow-${spark.tint})`,
  };
}

function Sparks(props: {
  readonly sparks: readonly GlowSpark[];
  readonly className: string;
}): ReactNode {
  return props.sparks.map((spark) => (
    <span
      key={`${spark.tint}-${String(spark.at)}`}
      className={props.className}
      data-phase={spark.phase}
      style={sparkStyleOf(spark)}
    />
  ));
}

type PlateStyle = CSSProperties & {
  readonly "--fx-beam-radius": string;
  readonly "--fx-corner": string;
};

function plateStyleOf(box: Box | null): PlateStyle | undefined {
  if (box === null) return undefined;
  return {
    "--fx-beam-radius": `${String(box.radius)}px`,
    "--fx-corner": box.shape,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  };
}

/**
 * 판: 번짐 겹(입력창만, 상자 안쪽으로), 선 겹(1px 고리의 아래쪽: 흐르는 무지개 + 숨 쉬는 알갱이), 멈춘 선(wait·still).
 * box가 없으면(BeamEdge) CSS가 부모에 맞춘다
 */
function GlowPlate(props: {
  readonly box: Box | null;
  readonly look: BeamLook;
  readonly variant: GlowVariant;
}): ReactNode {
  const scheme = useFxScheme();
  const tune = GLOW_TUNE[props.variant];
  const live = props.look === "run";
  // 꺼지면 판째 없앤다(턴이 끝나면 바로 사라진다. 쉬는 동안 합성 층도 0)
  if (props.look === "off") return null;
  return (
    <div
      aria-hidden
      className="fx-beam"
      data-look={props.look}
      data-variant={props.variant}
      data-scheme={scheme}
      style={plateStyleOf(props.box)}
    >
      {live && tune.bloom.length > 0 ? (
        <div className="fx-glow-bloom">
          <Sparks sparks={tune.bloom} className="fx-glow-cloud" />
        </div>
      ) : null}
      <div className="fx-glow-edge">
        {live ? (
          <>
            <span className="fx-glow-flow" />
            <Sparks sparks={tune.line} className="fx-glow-spark" />
          </>
        ) : null}
        <span className="fx-glow-hold" />
      </div>
      {props.variant === "field" ? <span className="fx-glow-haze" /> : null}
    </div>
  );
}

/** 아래 변 빛(입력창). 대상을 재서 그 위에 판을 겹친다 */
export function BeamScope(props: {
  readonly state: BeamState;
  /** 빛을 겹칠 대상. 없으면 감싼 판 자체 */
  readonly target?: string;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  const scope = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const reduced = useMotionReduced();
  const target = props.target;
  useLayoutEffect(() => {
    const el = scope.current;
    if (el === null || typeof ResizeObserver === "undefined") return undefined;
    let watched: Element | null = null;
    const measure = (): void => {
      const found = target === undefined ? el : el.querySelector(target);
      if (found !== watched) {
        if (watched !== null && watched !== el) resize.unobserve(watched);
        watched = found;
        if (found !== null && found !== el) resize.observe(found);
      }
      if (found === null) {
        setBox(null);
        return;
      }
      const style = getComputedStyle(found);
      const next = boxOf(
        el.getBoundingClientRect(),
        found.getBoundingClientRect(),
        style.borderTopLeftRadius,
        style.getPropertyValue("corner-shape"),
      );
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    // 대화를 바꾸면 입력창이 새로 그려진다(key). 바뀐 상자를 다시 찾는다
    const mutate = new MutationObserver(measure);
    mutate.observe(el, { childList: true, subtree: true });
    measure();
    return () => {
      resize.disconnect();
      mutate.disconnect();
    };
  }, [target]);
  return (
    <div ref={scope} className={["relative", props.className ?? ""].join(" ").trim()}>
      {props.children}
      {box === null ? null : (
        <GlowPlate box={box} look={beamLookOf(props.state, reduced)} variant="field" />
      )}
    </div>
  );
}

/**
 * 부모 요소의 아래 변에 선 겹만 있는 작은 빛(실행 중 칩, dzE 시안 §3). 부모는 `position: relative`이고 1px 테두리를 가진다.
 * 판은 CSS가 부모 테두리 위(inset -1px)에 두고 반경은 부모를 따른다(잴 것이 없다)
 */
export function BeamEdge(props: { readonly state: BeamState }): ReactNode {
  const reduced = useMotionReduced();
  return (
    <span aria-hidden className="fx-beam-edge">
      <GlowPlate box={null} look={beamLookOf(props.state, reduced)} variant="chip" />
    </span>
  );
}

/**
 * 아래 변을 흐르는 선(대화를 불러오는 동안 머리 줄 아래). border-beam `line` 그대로다. `position: relative`인 부모를 덮고
 * 아래 변에서 위로 번진다. 꺼져 있으면 border-beam이 애니메이션을 걸지 않는다
 */
export function BeamLine(props: { readonly active: boolean }): ReactNode {
  const scheme = useFxScheme();
  const reduced = useMotionReduced();
  const look: BeamLook = props.active ? (reduced ? "still" : "run") : "off";
  const tune = LINE_TUNE[scheme];
  return (
    <div aria-hidden className="fx-line" data-look={look}>
      <BorderBeam
        size="line"
        active={look === "run"}
        theme={scheme}
        colorVariant="colorful"
        duration={tune.duration}
        strength={tune.strength}
        borderRadius={0}
        className="fx-line-plate"
      >
        <div className="fx-line-fill" />
      </BorderBeam>
      <span className="fx-beam-still" />
    </div>
  );
}

/** 턴이 끝난 순간(run → off) 한 번 반짝이는 동안 "done"을 낸다. 지금 띠 오로라의 끝남 표시다 */
export function useDoneFlash<T extends string>(
  state: T,
  running: T,
  idle: T,
  ms = 900,
): T | "done" {
  const [prev, setPrev] = useState(state);
  const [flash, setFlash] = useState(false);
  // 앞 상태와 견주어 그리는 중에 정한다(효과 안에서 상태를 바꾸지 않는다)
  if (prev !== state) {
    setPrev(state);
    setFlash(prev === running && state === idle && !isMotionReduced());
  }
  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => {
      setFlash(false);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [flash, ms]);
  return flash ? "done" : state;
}
