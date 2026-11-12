// 앱 모션 프리셋과 얇은 부품(DP-105, DP-108 [결정: 2026-11-11 사용자]). 값은 motion.ts의 EASE·DUR·SHIFT이고 넘치지 않는다.
// 쓰는 법과 부품별 안무: _notes/design/dz/dzM-design.md §4·§5.
// "움직임 줄이기"는 여기 한 곳(`isMotionReduced`·`useMotionReduced`)에서 정한다: 앱 설정(`<html data-motion="reduce">`) 또는 OS 설정.
// 줄이면 부품은 위치·크기·높이를 움직이지 않고 짧은 투명도만 남기거나(Presence, SwapFade) 바로 바뀐다(Collapse, PresenceItem, flipFrom).

import type { Transition, Variants } from "motion/react";
import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AnimatePresence,
  DUR,
  EASE,
  ENTER_BLUR,
  MotionConfig,
  SHIFT,
  motion,
  type Bezier,
} from "./motion.ts";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** 앱 설정 값(`<html data-motion>`)과 OS 설정으로 줄일지 정한다 */
export function motionReducedOf(dataMotion: string | undefined, osReduce: boolean): boolean {
  return dataMotion === "reduce" || osReduce;
}

/** 지금 움직임을 줄이는지. 창이 없으면(서버 렌더, 시험) 줄이지 않는다 */
export function isMotionReduced(): boolean {
  if (typeof document === "undefined") return false;
  const os =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCE_QUERY).matches;
  return motionReducedOf(document.documentElement.dataset["motion"], os);
}

/** 움직임 줄이기 값이 바뀔 때 부른다(앱 설정 속성, OS 설정). 돌려준 함수로 끊는다 */
export function subscribeMotionReduced(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  // 시험의 흉내 창에는 관찰자나 미디어 쿼리 구독이 없을 수 있다. 없으면 그 쪽은 듣지 않는다
  const observer = typeof MutationObserver === "function" ? new MutationObserver(onChange) : null;
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-motion"],
  });
  const media = typeof window.matchMedia === "function" ? window.matchMedia(REDUCE_QUERY) : null;
  const listening = media !== null && "addEventListener" in media ? media : null;
  listening?.addEventListener("change", onChange);
  return () => {
    observer?.disconnect();
    listening?.removeEventListener("change", onChange);
  };
}

/** 움직임을 줄이는지. 앱 설정이나 OS 설정이 바뀌면 다시 그린다 */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribeMotionReduced, isMotionReduced, () => false);
}

/** 앱 뿌리. motion 부품 전체가 같은 줄이기 값을 따른다(줄이면 위치·크기·배치 움직임이 꺼지고 투명도만 남는다) */
export function MotionRoot(props: { readonly children: ReactNode }): ReactNode {
  const reduced = useMotionReduced();
  return <MotionConfig reducedMotion={reduced ? "always" : "never"}>{props.children}</MotionConfig>;
}

/** CSS·WAAPI용 곡선 글자 */
export function cssBezier(curve: Bezier): string {
  return `cubic-bezier(${curve.join(", ")})`;
}

function tween(duration: number, ease: Bezier, delay = 0): Transition {
  return { duration, ease: [ease[0], ease[1], ease[2], ease[3]], delay };
}

export type PresetName = "block" | "band" | "screen" | "fade" | "pop" | "panelStart" | "panelEnd";

/** variants 이름: 들어오기 전(hidden) → 보임(shown) → 나감(gone) */
export const PRESETS: Readonly<Record<PresetName, Variants>> = {
  // 대화 블록, 카드, 알림: 투명도 + 6px 오름 + 흐림 4→0. 나갈 때 투명도 + 2px 위
  block: {
    hidden: { opacity: 0, y: SHIFT.block, filter: `blur(${String(ENTER_BLUR)}px)` },
    shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: tween(DUR.enter, EASE.enter) },
    gone: {
      opacity: 0,
      y: -SHIFT.exit,
      filter: "blur(0px)",
      transition: tween(DUR.exit, EASE.exit),
    },
  },
  // 입력창 위 띠: 아래에서 8px 올라와 가라앉는다. 나갈 때 4px 내려가며 사라진다
  band: {
    hidden: { opacity: 0, y: SHIFT.screen },
    shown: { opacity: 1, y: 0, transition: tween(DUR.enter, EASE.enter) },
    gone: { opacity: 0, y: SHIFT.screen / 2, transition: tween(DUR.exit, EASE.exit) },
  },
  // 화면 전환(fade-through): 새 화면만 8px 오르며 들어오고 옛 화면은 바로 사라진다
  screen: {
    hidden: { opacity: 0, y: SHIFT.screen },
    shown: { opacity: 1, y: 0, transition: tween(DUR.enter, EASE.enter) },
    gone: { opacity: 0, transition: { duration: 0 } },
  },
  fade: {
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: tween(DUR.enter, EASE.standard) },
    gone: { opacity: 0, transition: tween(DUR.exit, EASE.exit) },
  },
  // 떠 있는 작은 면(우물, 팝오버식): 0.98 + 투명도 + 4px
  pop: {
    hidden: { opacity: 0, scale: 0.98, y: -4 },
    shown: { opacity: 1, scale: 1, y: 0, transition: tween(DUR.enter, EASE.enter) },
    gone: { opacity: 0, scale: 0.98, transition: tween(DUR.exit, EASE.exit) },
  },
  panelStart: {
    hidden: { x: "-100%" },
    shown: { x: 0, transition: tween(DUR.layout, EASE.panel) },
    gone: { x: "-100%", transition: tween(DUR.exitLayout, EASE.exit) },
  },
  panelEnd: {
    hidden: { x: "100%" },
    shown: { x: 0, transition: tween(DUR.layout, EASE.panel) },
    gone: { x: "100%", transition: tween(DUR.exitLayout, EASE.exit) },
  },
};

/** 줄이기: 투명도만, 짧게 */
const REDUCED: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: tween(DUR.micro, EASE.standard) },
  gone: { opacity: 0, transition: tween(DUR.micro, EASE.standard) },
};

export function variantsOf(name: PresetName, reduced: boolean): Variants {
  return reduced ? REDUCED : PRESETS[name];
}

/** 하나가 들어오고 나간다. 나감이 끝날 때까지 마지막 내용을 DOM에 남긴다 */
export function Presence(props: {
  readonly show: boolean;
  readonly variant?: PresetName;
  /** 처음 그릴 때도 들어오는지. 기본 true */
  readonly initial?: boolean;
  readonly className?: string;
  readonly onExited?: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const reduced = useMotionReduced();
  const variants = variantsOf(props.variant ?? "block", reduced);
  return (
    <AnimatePresence
      initial={props.initial ?? true}
      {...(props.onExited === undefined ? {} : { onExitComplete: props.onExited })}
    >
      {props.show ? (
        <motion.div
          key="presence"
          className={props.className}
          variants={variants}
          initial="hidden"
          animate="shown"
          exit="gone"
        >
          {props.children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** 펼침·접힘. 높이를 실제로 잇고(0 ↔ auto) 내용은 60ms 늦게 나타난다. 다 펼친 뒤에는 넘침을 풀어 초점 고리가 잘리지 않는다 */
export function Collapse(props: {
  readonly open: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  const reduced = useMotionReduced();
  if (reduced) return props.open ? <div className={props.className}>{props.children}</div> : null;
  return (
    <AnimatePresence initial={false}>
      {props.open ? (
        <motion.div
          key="collapse"
          className={props.className}
          initial={{ height: 0, overflow: "hidden" }}
          animate={{
            height: "auto",
            transition: tween(DUR.layout, EASE.panel),
            transitionEnd: { overflow: "visible" },
          }}
          exit={{ height: 0, overflow: "hidden", transition: tween(DUR.exitLayout, EASE.standard) }}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: tween(DUR.enter, EASE.standard, 0.06) }}
            exit={{ opacity: 0, transition: tween(DUR.exit, EASE.exit) }}
          >
            {props.children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** 같은 자리의 내용 교체(지금 띠의 항목, 상태 글). 나가는 것은 배치에서 빠지고 새것이 4px 오르며 들어온다. 부모는 `position: relative`여야 한다 */
export function SwapFade(props: {
  readonly swapKey: string;
  readonly className?: string;
  readonly inline?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const reduced = useMotionReduced();
  const variants: Variants = reduced
    ? REDUCED
    : {
        hidden: { opacity: 0, y: 4 },
        shown: { opacity: 1, y: 0, transition: tween(DUR.enter, EASE.enter) },
        gone: { opacity: 0, y: -SHIFT.exit, transition: tween(DUR.exit, EASE.exit) },
      };
  const shared = {
    className: props.className,
    variants,
    initial: "hidden",
    animate: "shown",
    exit: "gone",
  } as const;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {props.inline === true ? (
        <motion.span key={props.swapKey} {...shared}>
          {props.children}
        </motion.span>
      ) : (
        <motion.div key={props.swapKey} {...shared}>
          {props.children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 목록 삽입·삭제. 자식은 `key`가 있는 `PresenceItem`이다. 처음 그린 항목은 움직이지 않는다 */
export function PresenceList(props: { readonly children: ReactNode }): ReactNode {
  return <AnimatePresence initial={false}>{props.children}</AnimatePresence>;
}

/** 목록 한 항목: 들어올 때 높이가 열리며 떠오르고, 나갈 때 높이를 접으며 사라져 아래 항목이 자연히 따라 올라온다 */
export function PresenceItem(props: {
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  const reduced = useMotionReduced();
  if (reduced) return <div className={props.className}>{props.children}</div>;
  return (
    <motion.div
      className={props.className}
      initial={{ height: 0, opacity: 0, overflow: "hidden" }}
      animate={{
        height: "auto",
        opacity: 1,
        transition: {
          height: tween(DUR.enter, EASE.panel),
          opacity: tween(DUR.enter, EASE.enter, 0.04),
        },
        transitionEnd: { overflow: "visible" },
      }}
      exit={{
        height: 0,
        opacity: 0,
        overflow: "hidden",
        transition: {
          height: tween(DUR.exitLayout, EASE.standard),
          opacity: tween(DUR.exit, EASE.exit),
        },
      }}
    >
      {props.children}
    </motion.div>
  );
}

/** 배치가 한 번에 바뀐 뒤 옛 자리(dx, dy)에서 transform만으로 이어 온다(FLIP). 줄이면 아무것도 하지 않는다 */
export function flipFrom(el: Element, dx: number, dy = 0): Animation | null {
  if ((dx === 0 && dy === 0) || isMotionReduced() || typeof el.animate !== "function") return null;
  return el.animate(
    [
      { transform: `translate(${String(dx)}px, ${String(dy)}px)` },
      { transform: "translate(0px, 0px)" },
    ],
    { duration: DUR.layout * 1000, easing: cssBezier(EASE.panel) },
  );
}

/** 화면 들어옴(fade-through) 키프레임: 투명도 + 8px 오름 */
const SCREEN_ENTER_KEYFRAMES: readonly Keyframe[] = [
  { opacity: 0, transform: `translateY(${String(SHIFT.screen)}px)` },
  { opacity: 1, transform: "translateY(0px)" },
];

/** 들어오는 중인 화면에 붙는 표지. 겹친 화면 전환(무대 안의 구역, 탭 안의 화면)이 두 번 겹쳐 돌지 않게 한다 */
const ENTERING = "data-screen-enter";

/**
 * 요소에 화면 들어옴을 한 번 건다. 줄이면 하지 않는다.
 * 바깥 화면이 이미 들어오는 중이면 건너뛰고, 안쪽 화면이 먼저 들어오기 시작했으면 그것을 멈추고 바깥 하나만 움직인다
 * (React는 안쪽 효과를 먼저 부른다). 그래서 겹친 전환에서도 투명도·거리가 한 번만 적용된다.
 */
function enterScreen(el: Element): Animation | null {
  if (isMotionReduced() || typeof el.animate !== "function") return null;
  const outer = el.parentElement?.closest(`[${ENTERING}]`);
  if (outer !== null && outer !== undefined) return null;
  for (const inner of el.querySelectorAll(`[${ENTERING}]`)) {
    for (const running of inner.getAnimations()) running.cancel();
    inner.removeAttribute(ENTERING);
  }
  el.setAttribute(ENTERING, "");
  const animation = el.animate([...SCREEN_ENTER_KEYFRAMES], {
    duration: DUR.enter * 1000,
    easing: cssBezier(EASE.enter),
  });
  const done = (): void => {
    el.removeAttribute(ENTERING);
  };
  animation.addEventListener("finish", done);
  animation.addEventListener("cancel", done);
  return animation;
}

/**
 * `key`가 바뀔 때마다(처음 그릴 때는 빼고) 붙인 요소가 화면 들어옴으로 나타난다. `null`은 숨은 상태라 세지 않는다:
 * 숨겨 둔 화면(keepAlive)이 다시 보이면 들어온다
 */
export function useScreenEnter<E extends Element>(key: string | null): RefObject<E | null> {
  const ref = useRef<E | null>(null);
  const last = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = key;
    if (before === undefined || key === null || key === before) return;
    if (ref.current !== null) enterScreen(ref.current);
  }, [key]);
  return ref;
}

/** `swapKey`가 바뀔 때마다 안의 내용이 화면 들어옴으로 나타난다(옛 내용은 바로 바뀐다). 화면·구역·탭 전환에 쓴다 */
export function ScreenSwap(props: {
  readonly swapKey: string;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  const box = useScreenEnter<HTMLDivElement>(props.swapKey);
  return (
    <div ref={box} className={props.className}>
      {props.children}
    </div>
  );
}

/** 요소들을 투명도로 한 번 나타나게 한다(패널 내용 교체). 줄이면 하지 않는다 */
export function fadeIn(els: Iterable<Element>): void {
  if (isMotionReduced()) return;
  for (const el of els) {
    if (typeof el.animate !== "function") continue;
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: DUR.enter * 1000,
      easing: cssBezier(EASE.standard),
    });
  }
}
