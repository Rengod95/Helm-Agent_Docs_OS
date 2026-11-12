// beam 부품(DP-107·125 [결정: 2026-11-12 사용자]). 모양과 움직임은 beam.css, 궤도는 beam-orbit.ts, 상태 판단은 순수 함수다.
// `BeamScope`는 감싼 내용 안에서 대상(`target` 선택자, 예: 입력창 상자 `.composer-box`)을 찾아 그 자리·반경·모서리 모양을 재고 그 위에 고리를 겹친다
// (대상 파일을 고치지 않고 바깥에서 붙인다). `BeamEdge`는 부모(예: 실행 중 칩)의 테두리에 같은 고리의 작은 변형을 붙인다.
// 고리는 누르기를 막지 않고(pointer-events: none) 화면 낭독에서 빠진다.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { isMotionReduced } from "../../lib/motion-presets.tsx";
import { Aurora, type AuroraState } from "./aurora.tsx";
import {
  cornerExponentOf,
  orbitKeyframesOf,
  orbitPointsOf,
  periodMsOf,
  trailLagMsOf,
} from "./beam-orbit.ts";
import { auroraOn } from "./fx-config.ts";

export type BeamState = "off" | "run" | "wait";

/** 턴이 돌면 run, 그 대화에 승인을 기다리는 요청이 있으면(턴이 돌아도) wait, 그 밖에는 off */
export function beamStateOf(input: {
  readonly running: boolean;
  readonly awaitingApproval: boolean;
}): BeamState {
  if (input.awaitingApproval) return "wait";
  return input.running ? "run" : "off";
}

type Box = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** 모서리 곡선 지수(beam-orbit `cornerExponentOf`). 원은 2, squircle은 4 */
  readonly exponent: number;
  /** 대상의 `corner-shape` 계산값. 고리 판이 같은 모양을 쓴다 */
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

/** 고리 크기 변형. field는 입력창(번짐 고리 + 알갱이 8개), chip은 칩(번짐 없음, 알갱이 4개) */
type BeamVariant = "field" | "chip";

const TRAIL: Record<BeamVariant, { readonly count: number; readonly gap: number }> = {
  field: { count: 8, gap: 14 },
  chip: { count: 5, gap: 7 },
};

/** 번짐 고리가 대상 상자 밖으로 나가는 거리(px). beam.css `.fx-beam-glow`의 inset과 같다 */
const GLOW_OUTSET = 3;

/**
 * 빛 알갱이들을 잰 상자의 둘레로 돌린다. transform 키프레임이라 합성기에서만 돈다. 꼬리 알갱이는 같은 궤도를 간격(px)만큼 늦게 따라가
 * 모서리에서도 꼬리가 테두리를 따라 휜다(dzE 시안 §1). 상자가 바뀌면 키프레임을 다시 만들되 돌던 자리(진행 비율)를 잇는다.
 * 돌지 않을 때(off·wait)는 멈춰 두고, 창이 숨으면 멈춘다
 */
function useOrbit(
  host: HTMLElement | null,
  box: Box | null,
  state: BeamState,
  variant: BeamVariant,
): void {
  const progress = useRef(0);
  useLayoutEffect(() => {
    if (host === null || box === null || isMotionReduced()) return undefined;
    const period = periodMsOf(getComputedStyle(host).getPropertyValue("--fx-beam-period"));
    const running: Animation[] = [];
    const trail = TRAIL[variant];
    for (const ring of host.querySelectorAll<HTMLElement>(".fx-beam-ring")) {
      const out = ring.parentElement?.classList.contains("fx-beam-glow") === true ? GLOW_OUTSET : 0;
      const orbit = {
        width: box.width + out * 2,
        height: box.height + out * 2,
        radius: box.radius + out,
        exponent: box.exponent,
      };
      const perimeter = orbitPointsOf(orbit).at(-1)?.at ?? 0;
      for (const [index, spark] of [
        ...ring.querySelectorAll<HTMLElement>(".fx-beam-spark"),
      ].entries()) {
        if (typeof spark.animate !== "function") continue;
        const frames = orbitKeyframesOf(orbit, {
          width: spark.offsetWidth,
          height: spark.offsetHeight,
        });
        const animation = spark.animate(frames, { duration: period, iterations: Infinity });
        const lag = trailLagMsOf(index, trail.gap, perimeter, period);
        animation.currentTime = (((progress.current * period - lag) % period) + period) % period;
        if (state !== "run" || document.hidden) animation.pause();
        running.push(animation);
      }
    }
    const onVisibility = (): void => {
      for (const animation of running) {
        if (document.hidden || state !== "run") animation.pause();
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
  }, [host, box, state, variant]);
}

type SparkStyle = CSSProperties & { readonly "--i": number };

/** 꼬리 순번(0이 머리). beam.css가 빛깔과 투명도를 정한다 */
function sparkStyleOf(index: number): SparkStyle {
  return { "--i": index };
}

function Sparks(props: { readonly count: number }): ReactNode {
  return Array.from({ length: props.count }, (_, i) => (
    <span key={i} className="fx-beam-spark" style={sparkStyleOf(i)} />
  ));
}
type RingStyle = CSSProperties & {
  readonly "--fx-beam-radius": string;
  readonly "--fx-beam-corner": string;
};

function ringStyleOf(box: Box, placed: boolean): RingStyle {
  const shape = { "--fx-beam-radius": `${String(box.radius)}px`, "--fx-beam-corner": box.shape };
  return placed
    ? { ...shape, left: box.left, top: box.top, width: box.width, height: box.height }
    : shape;
}

/** 잰 상자 위의 고리 판(번짐 고리 + 1px 고리, 그 안을 도는 알갱이들) */
function BeamRing(props: {
  readonly box: Box;
  readonly state: BeamState;
  readonly variant: BeamVariant;
  readonly mode: "orbit" | "pulse";
  /** 판의 자리를 box로 둔다(BeamScope). 아니면 CSS가 부모에 맞춘다(BeamEdge) */
  readonly placed: boolean;
}): ReactNode {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useOrbit(props.mode === "pulse" ? null : host, props.box, props.state, props.variant);
  const count = TRAIL[props.variant].count;
  return (
    <div
      ref={setHost}
      aria-hidden
      className="fx-beam"
      data-state={props.state}
      data-mode={props.mode}
      data-variant={props.variant}
      style={ringStyleOf(props.box, props.placed)}
    >
      {props.variant === "field" ? (
        <div className="fx-beam-glow">
          <div className="fx-beam-ring">
            <Sparks count={count} />
          </div>
        </div>
      ) : null}
      <div className="fx-beam-ring">
        <Sparks count={count} />
      </div>
    </div>
  );
}

/** 턴이 끝난 순간(run → off) 한 번 반짝이는 동안 "done"을 낸다. 오로라의 끝남 표시다 */
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

/** 테두리를 도는 빛. `mode="pulse"`는 제자리 맥동이다. `aurora`면 대상 바깥에 오로라 띠를 함께 둔다(dzE 시안 §2.3) */
export function BeamScope(props: {
  readonly state: BeamState;
  /** 고리를 겹칠 대상. 없으면 감싼 판 자체 */
  readonly target?: string;
  readonly mode?: "orbit" | "pulse";
  readonly aurora?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  const scope = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const target = props.target;
  const aurora = props.aurora === true && auroraOn("composer");
  const auroraState: AuroraState = useDoneFlash(props.state, "run", "off");
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
    <div
      ref={scope}
      className={["relative", aurora ? "isolate" : "", props.className ?? ""]
        .filter((part) => part !== "")
        .join(" ")}
    >
      {box === null || !aurora ? null : (
        <Aurora state={auroraState} site="composer" style={ringStyleOf(box, true)} />
      )}
      {props.children}
      {box === null ? null : (
        <BeamRing
          box={box}
          state={props.state}
          variant="field"
          mode={props.mode ?? "orbit"}
          placed
        />
      )}
    </div>
  );
}

/**
 * 부모 요소의 테두리 위를 도는 작은 beam(실행 중 칩, dzE 시안 §3). 부모는 `position: relative`이고 1px 테두리를 가진다.
 * 판은 CSS가 부모 테두리 위(inset -1px)에 두고, 여기서는 크기와 반경만 잰다(칩의 경과 초가 바뀌면 폭이 바뀐다)
 */
export function BeamEdge(props: { readonly state: BeamState }): ReactNode {
  const probe = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
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
        <BeamRing box={box} state={props.state} variant="chip" mode="orbit" placed={false} />
      )}
    </span>
  );
}

/** 아래 변을 흐르는 선. `position: relative`인 부모의 아래 끝에 붙는다 */
export function BeamLine(props: { readonly active: boolean }): ReactNode {
  return (
    <div aria-hidden className="fx-line" data-state={props.active ? "run" : "off"}>
      <span className="fx-line-streak" />
    </div>
  );
}
