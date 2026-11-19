// cvD 시점: 밀기(빈 곳 끌기, 휠), 확대(⌘/Ctrl+휠, 단추), 맞추기. 노드 좌표는 내용 좌표이고 시점이 화면으로 옮긴다.
// 배경 격자와 셰이더는 같은 시점을 받는다. 시점이 바뀔 때만 다시 그린다(가만히 있으면 일이 없다).
import { t } from "@fresnel/client/i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import type { View } from "./backdrop.tsx";
import { Icon } from "./glyphs.tsx";

const MIN_K = 0.4;
const MAX_K = 1.6;

export interface Viewport {
  readonly view: View;
  readonly fit: () => void;
  readonly zoomBy: (factor: number) => void;
  /** 화면 좌표 → 내용 좌표 */
  readonly toContent: (clientX: number, clientY: number) => readonly [number, number];
  readonly onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

function clampK(k: number): number {
  return Math.min(MAX_K, Math.max(MIN_K, k));
}

/** 내용이 화면 안에 들도록. 100%보다 키우지 않고, 왼쪽 위에 붙인다(도구 화면처럼). `inset`은 패널과 앱 가장자리 막대가 가리는 폭 */
function fitView(
  box: DOMRect,
  w: number,
  h: number,
  inset: { readonly left: number; readonly right: number; readonly top: number },
): View {
  const availW = box.width - inset.left - inset.right - 48;
  const availH = box.height - inset.top - 56;
  // 글이 읽히는 아래 한도(0.82). 그보다 좁으면 오른쪽이 넘치고 밀어서 본다
  const k = clampK(Math.max(0.82, Math.min(1, availW / w, availH / h)));
  return {
    k,
    x: inset.left + 24 + Math.max(0, Math.min(48, (availW - w * k) / 2)),
    y: inset.top + 8,
  };
}

export function useViewport(
  ref: RefObject<HTMLDivElement | null>,
  w: number,
  h: number,
  inset: { readonly left: number; readonly right: number; readonly top: number },
): Viewport {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  const size = useRef({ w, h, inset });
  // 이벤트 처리기가 읽는 마지막 값(렌더 중에는 쓰지 않는다)
  useLayoutEffect(() => {
    viewRef.current = view;
    size.current = { w, h, inset };
  });

  const fit = useCallback(() => {
    const el = ref.current;
    if (el === null) return;
    setView(
      fitView(el.getBoundingClientRect(), size.current.w, size.current.h, size.current.inset),
    );
  }, [ref]);

  // 처음과 창 크기가 바뀔 때 맞춘다
  useLayoutEffect(() => {
    fit();
    const el = ref.current;
    if (el === null) return undefined;
    let last = el.getBoundingClientRect();
    const ro = new ResizeObserver(() => {
      const next = el.getBoundingClientRect();
      if (Math.abs(next.width - last.width) > 1 || Math.abs(next.height - last.height) > 1) fit();
      last = next;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [fit, ref]);

  // 왼쪽 패널을 접거나 펴면 다시 맞춘다
  useLayoutEffect(fit, [fit, inset.left]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const k = clampK(v.k * factor);
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = ref.current;
      if (el === null) return;
      const box = el.getBoundingClientRect();
      zoomAt(factor, box.width / 2, box.height / 2);
    },
    [zoomAt, ref],
  );

  // 휠은 기본 스크롤을 막아야 해서 수동 리스너다(passive: false)
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - box.left, e.clientY - box.top);
        return;
      }
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [zoomAt, ref]);

  const toContent = useCallback(
    (clientX: number, clientY: number): readonly [number, number] => {
      const el = ref.current;
      const v = viewRef.current;
      if (el === null) return [0, 0];
      const box = el.getBoundingClientRect();
      return [(clientX - box.left - v.x) / v.k, (clientY - box.top - v.y) / v.k];
    },
    [ref],
  );

  // 빈 곳(data-pan)을 끌면 민다
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!(e.target instanceof Element) || e.target.closest("[data-pan]") === null) return;
    if (e.target.closest("[data-node]") !== null) return;
    const start = { x: e.clientX, y: e.clientY, v: viewRef.current };
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent): void => {
      setView({
        ...start.v,
        x: start.v.x + m.clientX - start.x,
        y: start.v.y + m.clientY - start.y,
      });
    };
    const up = (): void => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, []);

  return { view, fit, zoomBy, toContent, onPointerDown };
}

/** 내용 층: 시점 변환을 건다 */
export function Stage(props: {
  readonly view: View;
  readonly w: number;
  readonly h: number;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      className="absolute top-0 left-0 origin-top-left"
      style={{
        width: props.w,
        height: props.h,
        transform: `translate(${props.view.x}px, ${props.view.y}px) scale(${props.view.k})`,
      }}
    >
      {props.children}
    </div>
  );
}

const TOOL_BTN =
  "inline-flex size-7 items-center justify-center rounded-[10px] text-text-secondary hover:bg-[var(--cs-color-fill-hover)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)]";

/** 확대 막대(오른쪽 아래). 도구 막대 반지름 14, 항목 10 */
export function ZoomBar(props: { readonly vp: Viewport }): ReactElement {
  const { vp } = props;
  return (
    <div
      role="toolbar"
      aria-label={t("desktop.craft.canvas.cvD.zoom.bar")}
      className="flex items-center gap-0.5 rounded-[14px] border border-border-subtle bg-surface-base p-1 shadow-[var(--cs-elevation-2)]"
    >
      <button
        type="button"
        data-slot="cvd"
        className={TOOL_BTN}
        aria-label={t("desktop.craft.canvas.cvD.zoom.out")}
        onClick={() => vp.zoomBy(1 / 1.2)}
      >
        <Icon name="minus" />
      </button>
      <span className="w-10 text-center font-mono text-[11px] text-text-tertiary tabular-nums">
        {Math.round(vp.view.k * 100)}%
      </span>
      <button
        type="button"
        data-slot="cvd"
        className={TOOL_BTN}
        aria-label={t("desktop.craft.canvas.cvD.zoom.in")}
        onClick={() => vp.zoomBy(1.2)}
      >
        <Icon name="plus" />
      </button>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border-default" />
      <button
        type="button"
        data-slot="cvd"
        className={TOOL_BTN}
        aria-label={t("desktop.craft.canvas.cvD.zoom.fit")}
        onClick={vp.fit}
      >
        <Icon name="fit" />
      </button>
    </div>
  );
}
