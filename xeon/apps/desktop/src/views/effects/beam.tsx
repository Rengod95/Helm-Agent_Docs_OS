// beam 부품(DP-107·160 [결정: 2026-11-12 사용자]). 사용자가 고른 질감은 border-beam(MIT, libraries.dev)의 `line`이다:
// 가는 무지개 선과 그 안쪽으로 부드럽게 번지는 빛이 숨 쉬듯 일렁인다(음성 녹음 이펙트). 사용자는 그것이 테두리를 따라 돌기를 원했다.
// - 머리 줄 아래(대화를 불러오는 중): 곧은 한 변이라 border-beam `line`을 그대로 쓴다(`BeamLine`).
// - 입력창·실행 중 칩: border-beam은 `line`을 아래 변에만 그리고(그레이디언트가 아래 변에 묶여 있다), 도는 `md`는 상자 가운데에서 본
//   conic 마스크라 712×84 같은 긴 상자에서 속도가 크게 달라지고 빛이 옅게 퍼진다(시안 dzU §1.2 비교). 그래서 `line`의 빛깔·층·숨을 옮긴
//   "물마루(crest)"를 둘레 위에서 같은 속도로 돌린다: 점 여럿이 잰 둘레를 간격을 두고 따라가며(beam-orbit.ts, transform 키프레임이라 합성기에서만 돈다)
//   1px 고리 마스크 아래에서는 무지개 선이, 상자 안에서는 번짐이 된다. 모서리에서도 선이 테두리를 따라 휜다.
// `BeamScope`는 감싼 내용 안에서 대상(`target`, 예: `.composer-box`)을 찾아 그 자리·반경·모서리 모양을 재고 그 위에 판을 겹친다.
// `BeamEdge`는 부모(실행 중 칩)의 테두리에 선만 있는 작은 변형을 붙인다. 판은 누르기를 막지 않고 화면 낭독에서 빠진다.
// 승인 대기(wait)는 빛이 멈추고 경고 색 고리로 고정된다. 움직임을 줄이면 정지한 은은한 고리다. 꺼져 있으면 애니메이션이 없다(쉬는 동안 프레임 0).

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
import { cornerExponentOf, orbitKeyframesOf, orbitPointsOf, trailLagMsOf } from "./beam-orbit.ts";
import { CREST_TUNE, LINE_TUNE, type CrestVariant } from "./fx-config.ts";
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

/** 판에 보일 모양. run은 도는 빛, still은 움직임을 줄였을 때의 정지 고리, wait는 경고 고리 */
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
  /** 모서리 곡선 지수(beam-orbit `cornerExponentOf`). 원은 2, squircle은 4 */
  readonly exponent: number;
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
    exponent: cornerExponentOf(corner),
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

/** 점 하나가 둘레 위 기준점보다 앞(음수) 또는 뒤(양수)에 서는 거리(px). 물마루는 가운데가 기준점이라 앞뒤가 같다 */
export function crestOffsetsOf(count: number, gap: number): readonly number[] {
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => (i - center) * gap);
}

/**
 * 점들을 잰 상자의 둘레로 돌린다. 상자가 바뀌면 키프레임을 다시 만들되 돌던 자리(진행 비율)를 잇는다.
 * 돌지 않을 때(still·wait·off)는 만들지 않고, 창이 숨으면 멈춘다
 */
function useCrestOrbit(
  host: HTMLElement | null,
  box: Box | null,
  look: BeamLook,
  variant: CrestVariant,
): void {
  const progress = useRef(0);
  useLayoutEffect(() => {
    if (host === null || box === null || look !== "run") return undefined;
    const tune = CREST_TUNE[variant];
    const period = tune.periodMs;
    const orbit = {
      width: box.width,
      height: box.height,
      radius: box.radius,
      exponent: box.exponent,
    };
    const perimeter = orbitPointsOf(orbit).at(-1)?.at ?? 0;
    const running: Animation[] = [];
    for (const track of host.querySelectorAll<HTMLElement>(".fx-crest-track")) {
      const gap = Number(track.dataset["gap"] ?? "0");
      const dots = [...track.querySelectorAll<HTMLElement>(".fx-crest-dot")];
      const offsets = crestOffsetsOf(dots.length, gap);
      for (const [index, dot] of dots.entries()) {
        if (typeof dot.animate !== "function") continue;
        const frames = orbitKeyframesOf(orbit, {
          width: dot.offsetWidth,
          height: dot.offsetHeight,
        });
        const animation = dot.animate(frames, { duration: period, iterations: Infinity });
        const lag = trailLagMsOf(1, offsets[index] ?? 0, perimeter, period);
        animation.currentTime = (((progress.current * period - lag) % period) + period) % period;
        if (document.hidden) animation.pause();
        running.push(animation);
      }
    }
    const onVisibility = (): void => {
      for (const animation of running) {
        if (document.hidden) animation.pause();
        else animation.play();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      const time = running[0]?.currentTime;
      if (typeof time === "number") progress.current = (time % period) / period;
      for (const animation of running) animation.cancel();
    };
  }, [host, box, look, variant]);
}

type DotStyle = CSSProperties & { readonly "--i": number; readonly "--k": number };

/** 점 순번(0이 앞끝). --k는 가운데에서 0, 양 끝에서 1(빛깔·투명도·숨이 이 값을 따른다) */
function dotStyleOf(index: number, count: number): DotStyle {
  const center = (count - 1) / 2;
  return { "--i": index, "--k": center === 0 ? 0 : Math.abs(index - center) / center };
}

function Track(props: {
  readonly layer: "line" | "bloom";
  readonly count: number;
  readonly gap: number;
}): ReactNode {
  return (
    <div className="fx-crest-track" data-layer={props.layer} data-gap={props.gap}>
      {Array.from({ length: props.count }, (_, i) => (
        <span key={i} className="fx-crest-dot" style={dotStyleOf(i, props.count)}>
          <span className="fx-crest-glow" />
        </span>
      ))}
    </div>
  );
}

type PlateStyle = CSSProperties & {
  readonly "--fx-beam-radius": string;
  readonly "--fx-corner": string;
};

function plateStyleOf(box: Box, placed: boolean): PlateStyle {
  const shape = { "--fx-beam-radius": `${String(box.radius)}px`, "--fx-corner": box.shape };
  return placed
    ? { ...shape, left: box.left, top: box.top, width: box.width, height: box.height }
    : shape;
}

/** 잰 상자 위의 판: 번짐 층(상자 안에서만 보인다), 1px 선 층, 정지 고리 */
function CrestPlate(props: {
  readonly box: Box;
  readonly look: BeamLook;
  readonly variant: CrestVariant;
  /** 판의 자리를 box로 둔다(BeamScope). 아니면 CSS가 부모에 맞춘다(BeamEdge) */
  readonly placed: boolean;
}): ReactNode {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const scheme = useFxScheme();
  useCrestOrbit(host, props.box, props.look, props.variant);
  const tune = CREST_TUNE[props.variant];
  return (
    <div
      ref={setHost}
      aria-hidden
      className="fx-beam"
      data-look={props.look}
      data-variant={props.variant}
      data-scheme={scheme}
      style={plateStyleOf(props.box, props.placed)}
    >
      {props.look === "run" ? (
        <>
          {tune.bloom.count > 0 ? (
            <Track layer="bloom" count={tune.bloom.count} gap={tune.bloom.gap} />
          ) : null}
          <Track layer="line" count={tune.line.count} gap={tune.line.gap} />
        </>
      ) : null}
      <span className="fx-beam-still" />
    </div>
  );
}

/** 테두리를 도는 빛(입력창). 대상을 재서 그 위에 판을 겹친다 */
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
        <CrestPlate box={box} look={beamLookOf(props.state, reduced)} variant="field" placed />
      )}
    </div>
  );
}

/**
 * 부모 요소의 테두리 위를 도는 작은 빛(실행 중 칩, dzE 시안 §3). 부모는 `position: relative`이고 1px 테두리를 가진다.
 * 판은 CSS가 부모 테두리 위(inset -1px)에 두고, 여기서는 크기와 반경만 잰다(칩의 경과 초가 바뀌면 폭이 바뀐다)
 */
export function BeamEdge(props: { readonly state: BeamState }): ReactNode {
  const probe = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const reduced = useMotionReduced();
  useLayoutEffect(() => {
    const el = probe.current;
    const parent = el?.parentElement ?? null;
    if (el === null || parent === null || typeof ResizeObserver === "undefined") return undefined;
    const measure = (): void => {
      const rect = parent.getBoundingClientRect();
      const style = getComputedStyle(parent);
      const next = boxOf(
        rect,
        rect,
        style.borderTopLeftRadius,
        style.getPropertyValue("corner-shape"),
      );
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    const resize = new ResizeObserver(measure);
    resize.observe(parent);
    measure();
    return () => {
      resize.disconnect();
    };
  }, []);
  return (
    <span ref={probe} aria-hidden className="fx-beam-edge">
      {box === null ? null : (
        <CrestPlate
          box={box}
          look={beamLookOf(props.state, reduced)}
          variant="chip"
          placed={false}
        />
      )}
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
