// 구성 화면 본문 폭으로 캔버스와 개요 편집기 가운데 하나를 고른다(§6.28.6). 창 폭이 아니라 본문 요소의 폭을 잰다.
// 기준 폭은 셸 폭 단계의 compact 경계(720)와 같다.
import { useEffect, useState, type RefObject } from "react";
import { layoutOf } from "../../state/shell/layout.ts";

/** 본문 폭이 compact(720 이하)면 캔버스 대신 개요 편집기를 쓴다 */
export function isCompactWidth(px: number): boolean {
  return layoutOf(px) === "compact";
}

/**
 * 요소의 content 폭을 잰다. 처음 그릴 때는 값이 없어 `undefined`이고(호출자는 캔버스로 본다),
 * 잴 수 없는 환경(ResizeObserver가 없음)에서도 `undefined`로 남는다.
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return undefined;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}
