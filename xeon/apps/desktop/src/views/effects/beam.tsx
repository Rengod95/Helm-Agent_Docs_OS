// beam 부품(DP-107 [결정: 2026-11-11 사용자]). 모양과 움직임은 beam.css, 상태 판단은 순수 함수다.
// `BeamScope`는 감싼 내용 안에서 대상(`target` 선택자, 예: 입력창 상자 `.composer-box`)을 찾아 그 자리와 반경을 재고 그 위에 고리를 겹친다.
// 대상의 파일(입력창은 dzT2b 범위)을 고치지 않고 바깥에서 붙이기 위해서다. 고리는 누르기를 막지 않고(pointer-events: none) 화면 낭독에서 빠진다.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isMotionReduced } from "../../lib/motion-presets.tsx";
import { orbitKeyframesOf, periodMsOf } from "./beam-orbit.ts";

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
};

/** 대상 상자의 자리(감싼 판 기준)와 모서리 반경. 반경을 읽지 못하면 16px */
export function boxOf(scope: DOMRect, target: DOMRect, radius: string): Box {
  const parsed = Number.parseFloat(radius);
  return {
    left: target.left - scope.left,
    top: target.top - scope.top,
    width: target.width,
    height: target.height,
    radius: Number.isFinite(parsed) ? parsed : 16,
  };
}

function sameBox(a: Box | null, b: Box): boolean {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.radius === b.radius
  );
}

/** 번짐 고리가 대상 상자 밖으로 나가는 거리(px). beam.css `.fx-beam-glow`의 inset과 같다 */
const GLOW_OUTSET = 3;

/**
 * 빛 덩어리 둘(고리, 번짐)을 잰 상자의 둘레로 돌린다. transform 키프레임이라 합성기에서만 돈다(dzM2 시안 §11).
 * 상자가 바뀌면 키프레임을 다시 만들되 돌던 자리(진행 비율)를 잇는다. 돌지 않을 때(off·wait)는 멈춰 둔다
 */
function useOrbit(host: HTMLDivElement | null, box: Box | null, state: BeamState): void {
  const progress = useRef(0);
  useLayoutEffect(() => {
    if (host === null || box === null || isMotionReduced()) return undefined;
    const sparks = [...host.querySelectorAll<HTMLElement>(".fx-beam-spark")];
    const period = periodMsOf(getComputedStyle(host).getPropertyValue("--fx-beam-period"));
    const running: Animation[] = [];
    for (const spark of sparks) {
      if (typeof spark.animate !== "function") continue;
      const glow = spark.closest(".fx-beam-glow") !== null;
      const out = glow ? GLOW_OUTSET : 0;
      const frames = orbitKeyframesOf(
        { width: box.width + out * 2, height: box.height + out * 2, radius: box.radius + out },
        { width: spark.offsetWidth, height: spark.offsetHeight },
      );
      const animation = spark.animate(frames, { duration: period, iterations: Infinity });
      animation.currentTime = progress.current * period;
      if (state !== "run") animation.pause();
      running.push(animation);
    }
    return () => {
      const first = running[0];
      const time = first?.currentTime;
      if (typeof time === "number") progress.current = (time % period) / period;
      for (const animation of running) animation.cancel();
    };
  }, [host, box, state]);
}

/** 테두리를 도는 빛. `mode="pulse"`는 제자리 맥동이다 */
export function BeamScope(props: {
  readonly state: BeamState;
  /** 고리를 겹칠 대상. 없으면 감싼 판 자체 */
  readonly target?: string;
  readonly mode?: "orbit" | "pulse";
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  const scope = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useOrbit(props.mode === "pulse" ? null : host, box, props.state);
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
      const next = boxOf(
        el.getBoundingClientRect(),
        found.getBoundingClientRect(),
        getComputedStyle(found).borderTopLeftRadius,
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
  // 반경은 CSS 변수로 넘겨 고리·번짐·빛의 경로(offset-path)가 같은 모서리를 쓴다
  const style: (CSSProperties & { readonly "--fx-beam-radius": string }) | undefined =
    box === null
      ? undefined
      : {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          "--fx-beam-radius": `${String(box.radius)}px`,
        };
  return (
    <div ref={scope} className={`relative ${props.className ?? ""}`}>
      {props.children}
      {box === null ? null : (
        <div
          ref={setHost}
          aria-hidden
          className="fx-beam"
          data-state={props.state}
          data-mode={props.mode ?? "orbit"}
          style={style}
        >
          <div className="fx-beam-glow">
            <div className="fx-beam-ring">
              <span className="fx-beam-spark" />
            </div>
          </div>
          <div className="fx-beam-ring">
            <span className="fx-beam-spark" />
          </div>
        </div>
      )}
    </div>
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
