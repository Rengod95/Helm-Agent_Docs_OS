// 앱 모션 프리셋과 얇은 부품(DP-105, DP-108 [결정: 2026-11-11 사용자]). 값은 motion.ts의 EASE·DUR·SHIFT이고 넘치지 않는다.
// 쓰는 법과 부품별 안무: _notes/design/dz/dzM-design.md §4·§5.
// "움직임 줄이기"는 여기 한 곳(`isMotionReduced`·`useMotionReduced`)에서 정한다: 앱 설정(`<html data-motion="reduce">`) 또는 OS 설정.
// 줄이면 부품은 위치·크기·높이를 움직이지 않고 짧은 투명도만 남기거나(Presence, SwapFade) 바로 바뀐다(Collapse, PresenceItem, flipFrom).

import type { Transition, Variants } from "motion/react";
import {
  useLayoutEffect,
  useRef,
  useState,
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
  /** 목록(`ul`) 안이면 "li" */
  readonly as?: "div" | "li";
  readonly children: ReactNode;
}): ReactNode {
  const reduced = useMotionReduced();
  const li = props.as === "li";
  if (reduced)
    return li ? (
      <li className={props.className}>{props.children}</li>
    ) : (
      <div className={props.className}>{props.children}</div>
    );
  const Item = li ? motion.li : motion.div;
  return (
    <Item
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
    </Item>
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

// ── 대화 줄 들어옴(dzM2 시안 §2, DP-117) ─────────────────────────────────────────

/** 줄 들어옴의 갈래. 줄 종류(`TranscriptRow["kind"]`)를 `views/transcript-enter.ts`가 이 값으로 옮긴다 */
export type RowEnter =
  | "user"
  | "reply"
  | "quiet"
  | "card"
  | "foot"
  | "divider"
  | "compaction"
  | "leadHead";

type EnterTrack = {
  /** 없으면 요소 자체, 있으면 그 가상 요소(`::before`·`::after`)나 그 선택자로 찾은 자식 */
  readonly pseudo?: "::before" | "::after";
  readonly child?: string;
  readonly keyframes: readonly Keyframe[];
  readonly duration: number;
  readonly easing: Bezier;
  readonly delay?: number;
};

const rise = (px: number, blur = 0): readonly Keyframe[] => [
  {
    opacity: 0,
    transform: `translateY(${String(px)}px)`,
    ...(blur > 0 ? { filter: `blur(${String(blur)}px)` } : {}),
  },
  { opacity: 1, transform: "translateY(0px)", ...(blur > 0 ? { filter: "blur(0px)" } : {}) },
];
const FADE: readonly Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const DRAW_X: readonly Keyframe[] = [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }];

/** 갈래별 키프레임(ms, 곡선). 순수 값이라 시험이 끝값과 넘침 없음을 본다 */
export const ROW_ENTER: Readonly<Record<RowEnter, readonly EnterTrack[]>> = {
  // 입력창에서 올라온 듯: 12px 오름
  user: [{ keyframes: rise(12), duration: 220, easing: EASE.enter }],
  // 초점이 맞듯: 6px 오름 + 흐림 4 → 0
  reply: [{ keyframes: rise(SHIFT.block, ENTER_BLUR), duration: 200, easing: EASE.enter }],
  // 조용히: 4px 오름
  quiet: [{ keyframes: rise(4), duration: 160, easing: EASE.enter }],
  // 카드: 조금 더 깊은 초점 맞춤
  card: [{ keyframes: rise(SHIFT.block, 6), duration: 240, easing: EASE.enter }],
  // 턴 발 줄: 답 뒤에 늦게, 투명도만
  foot: [{ keyframes: FADE, duration: 160, easing: EASE.standard, delay: 60 }],
  // 변화 표지: 글은 투명도, 양쪽 선은 글 쪽에서 바깥으로 그어진다(원점은 convo.css)
  divider: [
    { child: ".convo-divider", keyframes: FADE, duration: 160, easing: EASE.standard },
    {
      child: ".convo-divider",
      pseudo: "::before",
      keyframes: DRAW_X,
      duration: 280,
      easing: EASE.panel,
    },
    {
      child: ".convo-divider",
      pseudo: "::after",
      keyframes: DRAW_X,
      duration: 280,
      easing: EASE.panel,
    },
  ],
  // 요약 구분선: 표지와 같은 선 + 빛 줄기가 한 번 지나간다(`.convo-compact-sweep`)
  compaction: [
    { child: ".convo-divider", keyframes: FADE, duration: 160, easing: EASE.standard },
    {
      child: ".convo-divider",
      pseudo: "::before",
      keyframes: DRAW_X,
      duration: 280,
      easing: EASE.panel,
    },
    {
      child: ".convo-divider",
      pseudo: "::after",
      keyframes: DRAW_X,
      duration: 280,
      easing: EASE.panel,
    },
    {
      child: ".convo-compact-sweep",
      keyframes: [
        { opacity: 0, transform: "translateX(-100%)" },
        { opacity: 1, transform: "translateX(40%)", offset: 0.35 },
        { opacity: 0, transform: "translateX(180%)" },
      ],
      duration: 900,
      easing: EASE.standard,
      delay: 80,
    },
  ],
  // 주도 머리: 답과 같은 초점 맞춤 + 레일이 위에서 아래로 그어진다
  leadHead: [
    { keyframes: rise(SHIFT.block, ENTER_BLUR), duration: 200, easing: EASE.enter },
    {
      pseudo: "::before",
      keyframes: [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
      duration: 280,
      easing: EASE.panel,
    },
  ],
};

/**
 * 줄 하나에 들어옴을 한 번 건다(WAAPI). 줄 틀의 transform·opacity·filter만 움직여 줄 높이(가상 목록이 재는 값)는 그대로다.
 * 줄이면 120ms 투명도만 한다. 돌린 애니메이션 수를 돌려준다(시험·측정용)
 */
export function playRowEnter(el: Element, kind: RowEnter): number {
  if (typeof el.animate !== "function") return 0;
  if (isMotionReduced()) {
    el.animate([...FADE], { duration: DUR.micro * 1000, easing: cssBezier(EASE.standard) });
    return 1;
  }
  let count = 0;
  for (const track of ROW_ENTER[kind]) {
    const target = track.child === undefined ? el : el.querySelector(track.child);
    if (target === null || typeof target.animate !== "function") continue;
    target.animate([...track.keyframes], {
      duration: track.duration,
      easing: cssBezier(track.easing),
      delay: track.delay ?? 0,
      fill: "backwards",
      ...(track.pseudo === undefined ? {} : { pseudoElement: track.pseudo }),
    });
    count += 1;
  }
  return count;
}

// ── 높이 잇기(dzM2 시안 §4) ───────────────────────────────────────────────────

/**
 * 안 내용의 높이가 바뀌면(줄이 사라지거나 생김) 옛 높이에서 새 높이로 잇는다. 펼침 경계(`Collapse`)가 아닌 곳,
 * 예를 들어 끝난 활동 묶음의 접힌 몸이 요약 한 줄로 모일 때 쓴다. 처음 그릴 때는 넘겨받은 높이(`handoff`)가 있을 때만 움직이고,
 * 줄이기에서는 움직이지 않는다. 계속 자라는 내용(스트리밍)에는 쓰지 않는다
 */
export function HeightGlide(props: {
  readonly className?: string;
  /** 같은 커밋에서 떠난 줄의 키(`handoffHeight`). 있으면 처음 그릴 때 그 높이에서 지금 높이로 잇는다 */
  readonly handoff?: string;
  readonly children: ReactNode;
}): ReactNode {
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const { handoff } = props;
  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (box === null || content === null || typeof ResizeObserver === "undefined") return undefined;
    let last = content.getBoundingClientRect().height;
    let running: Animation | null = null;
    const glide = (from: number, next: number): void => {
      if (Math.abs(next - from) < 1 || isMotionReduced() || typeof box.animate !== "function")
        return;
      running?.cancel();
      box.style.overflow = "hidden";
      const shrink = next < from;
      const animation = box.animate(
        [{ height: `${String(from)}px` }, { height: `${String(next)}px` }],
        {
          duration: (shrink ? DUR.exitLayout : DUR.enter) * 1000,
          easing: cssBezier(shrink ? EASE.standard : EASE.panel),
        },
      );
      running = animation;
      const done = (): void => {
        if (running !== animation) return;
        running = null;
        box.style.overflow = "";
      };
      animation.addEventListener("finish", done);
      animation.addEventListener("cancel", done);
    };
    const observer = new ResizeObserver(() => {
      const next = content.getBoundingClientRect().height;
      // 높이가 그대로면(너비만 바뀜) 가는 중인 잇기를 다시 겨누지 않는다
      if (next === last) return;
      const from = running === null ? last : box.getBoundingClientRect().height;
      last = next;
      glide(from, next);
    });
    const left = handoff === undefined ? undefined : handoffHeightOf(handoff);
    if (left !== undefined) glide(left, last);
    observer.observe(content);
    return () => {
      observer.disconnect();
      running?.cancel();
    };
  }, [handoff]);
  return (
    <div ref={outer} className={props.className}>
      <div ref={inner}>{props.children}</div>
    </div>
  );
}

// ── 줄 넘겨받기(dzM2 시안 §4) ─────────────────────────────────────────────────

/** 같은 커밋 안에서 떠나는 줄이 남긴 높이. 값은 한 틱 뒤에 지운다 */
const handoffs = new Map<string, number>();

/**
 * 줄이 떠날 때(언마운트) 자기 높이를 남긴다. 확정되며 쓰는 중이던 도구 호출 줄이 실행 중 줄로 바뀔 때처럼
 * 같은 커밋에서 새 줄이 서는 자리에서 쓴다. 한 틱이 지나면 지우므로 다른 커밋에서 다시 그린 줄(가상 목록 재마운트, 과거 대화)은 받지 못한다
 */
export function handoffHeight(key: string, px: number): void {
  handoffs.set(key, px);
  queueMicrotask(() => {
    handoffs.delete(key);
  });
}

/** 같은 커밋에서 남긴 높이(없으면 undefined). 읽기만 하므로 두 번 실행되는 효과도 같은 값을 본다 */
export function handoffHeightOf(key: string): number | undefined {
  return handoffs.get(key);
}

// ── 상태 바뀜 ────────────────────────────────────────────────────────────────

/**
 * 값이 이 부품이 마운트된 뒤에 바뀌었는지. 처음 값 그대로면 false, 한 번이라도 바뀌면 그 뒤로 true다.
 * 상태 바뀜 움직임(체크 그리기, 실패 번짐)을 "바뀐 순간"에만 돌리고, 이미 끝난 줄을 다시 그릴 때는 돌리지 않으려고 쓴다
 */
export function useChangedSinceMount(value: string): boolean {
  const [first] = useState(value);
  const [changed, setChanged] = useState(false);
  // 이전 그림의 값에서 정하는 상태(React "이전 렌더의 정보 저장" 꼴). 한 번 바뀌면 처음 값으로 돌아와도 true다
  if (!changed && value !== first) setChanged(true);
  return changed || value !== first;
}

// ── 목록 FLIP(dzM2 시안 §11) ─────────────────────────────────────────────────

/** 옛 자리와 새 자리에서 움직일 거리. 처음 보는 키는 들어옴, 그대로면 null */
export function flipDeltaOf(
  before: ReadonlyMap<string, number>,
  key: string,
  top: number,
): { readonly kind: "move"; readonly dy: number } | { readonly kind: "enter" } | null {
  const old = before.get(key);
  if (old === undefined) return { kind: "enter" };
  const dy = old - top;
  return Math.abs(dy) < 0.5 ? null : { kind: "move", dy };
}

/**
 * 컨테이너 안 `[data-flip-key]` 요소의 자리 변화를 transform으로 잇는다(삽입: 투명도 + 4px, 이동: 옛 자리에서 미끄러짐).
 * `version`이 바뀐 커밋에서만 본다. 처음 그릴 때와 `scope`가 바뀐 커밋(찾기 글 바뀜 같은 거르기)은 자리만 새로 적고 움직이지 않는다
 */
export function useFlipList(
  container: RefObject<Element | null>,
  version: string,
  scope: string,
): void {
  const tops = useRef<Map<string, number> | null>(null);
  const last = useRef({ version, scope });
  useLayoutEffect(() => {
    const animate = last.current.scope === scope && last.current.version !== version;
    last.current = { version, scope };
    const root = container.current;
    if (root === null) return;
    // 컨테이너 기준 자리라 목록이 스크롤돼도 옛 값이 틀어지지 않는다
    const origin = root.getBoundingClientRect().top;
    const next = new Map<string, number>();
    const els = [...root.querySelectorAll<HTMLElement>("[data-flip-key]")];
    for (const el of els) {
      const key = el.dataset["flipKey"];
      if (key !== undefined) next.set(key, el.getBoundingClientRect().top - origin);
    }
    const before = tops.current;
    tops.current = next;
    if (before === null || !animate || isMotionReduced()) return;
    for (const el of els) {
      const key = el.dataset["flipKey"];
      if (key === undefined || typeof el.animate !== "function") continue;
      const delta = flipDeltaOf(before, key, next.get(key) ?? 0);
      if (delta === null) continue;
      if (delta.kind === "enter") {
        el.animate([...rise(4)], { duration: 160, easing: cssBezier(EASE.enter) });
      } else {
        el.animate(
          [{ transform: `translateY(${String(delta.dy)}px)` }, { transform: "translateY(0px)" }],
          { duration: DUR.layout * 1000, easing: cssBezier(EASE.panel) },
        );
      }
    }
  }, [container, version, scope]);
}

/**
 * 켜져 있는 동안 요소의 높이가 줄어들지 않게 한다(가장 컸던 높이를 최소 높이로 지킨다). 꺼지면 풀린다.
 * 스트리밍 중인 답(dzM2 시안 §5): 닫는 울타리를 치는 중(코드 한 줄이 잠깐 생겼다 사라짐), 표 머리가 아직 끝나지 않은 순간처럼
 * 마크다운이 잠깐 짧아지는 프레임이 있다(측정 12~31px). 그동안 아래 줄과 따라 내려가기가 위아래로 튀지 않는다
 */
export function useHeightRatchet<E extends HTMLElement>(active: boolean): RefObject<E | null> {
  const el = useRef<E | null>(null);
  useLayoutEffect(() => {
    const box = el.current;
    if (box === null) return undefined;
    if (!active || typeof ResizeObserver === "undefined") {
      box.style.minHeight = "";
      return undefined;
    }
    let max = 0;
    const observer = new ResizeObserver(() => {
      const height = box.offsetHeight;
      if (height > max) {
        max = height;
        box.style.minHeight = `${String(max)}px`;
      }
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [active]);
  return el;
}
