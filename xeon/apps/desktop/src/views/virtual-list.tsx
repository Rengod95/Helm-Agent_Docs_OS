import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

// 가상 스크롤(L4.desktop.spec 4.10 수단 3). 화면에 보이는 행과 앞뒤 여유분만 DOM에 둔다.
// 행 높이는 고정하지 않는다(V7): 마운트된 행을 ResizeObserver로 재고, 재지 않은 행은 추정값을 쓴다.
// 이 부품의 상태(스크롤 위치, 잰 높이)는 이 부품만 읽으므로 전역 스토어에 두지 않는다(FS-04).

export type VirtualRow = { readonly key: string };

const ESTIMATED_HEIGHT = 96;
const OVERSCAN_PX = 600;
const STICK_THRESHOLD_PX = 48;

type Props<R extends VirtualRow> = {
  readonly rows: readonly R[];
  readonly renderRow: (row: R) => ReactNode;
  /** 바닥에 붙어 있을 때 새 내용이 오면 따라 내려간다 */
  readonly followTail: boolean;
};

/** 시작 위치 offsets[i] (i번째 행의 위쪽)와 전체 높이 */
function layout(
  keys: readonly string[],
  heights: ReadonlyMap<string, number>,
): { offsets: number[]; total: number } {
  const offsets: number[] = [];
  let total = 0;
  for (const key of keys) {
    offsets.push(total);
    total += heights.get(key) ?? ESTIMATED_HEIGHT;
  }
  return { offsets, total };
}

/** top 위치를 덮는 첫 행의 인덱스 */
function firstAtOrAfter(
  offsets: readonly number[],
  heights: (index: number) => number,
  top: number,
): number {
  let low = 0;
  let high = offsets.length - 1;
  let found = offsets.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((offsets[mid] ?? 0) + heights(mid) > top) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return found;
}

export function VirtualList<R extends VirtualRow>(props: Props<R>): ReactNode {
  const { rows, renderRow, followTail } = props;
  const scroller = useRef<HTMLDivElement | null>(null);
  const stuck = useRef(true);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  // 잰 높이. 렌더가 읽으므로 상태다. 관찰자 콜백은 모아 두었다가 프레임마다 한 번 반영한다
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const measured = useRef<Map<string, number>>(new Map());
  const frame = useRef<number | null>(null);

  const [observer, setObserver] = useState<ResizeObserver | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const created = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const key = entry.target.getAttribute("data-row-key");
        if (key === null) continue;
        measured.current.set(
          key,
          Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height),
        );
      }
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const batch = measured.current;
        measured.current = new Map();
        setHeights((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const [key, height] of batch) {
            if (next.get(key) !== height) {
              next.set(key, height);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });
    });
    setObserver(created);
    return () => {
      created.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);

  const keys = useMemo(() => rows.map((r) => r.key), [rows]);
  const { offsets, total } = layout(keys, heights);
  const heightAt = (index: number): number => heights.get(keys[index] ?? "") ?? ESTIMATED_HEIGHT;

  const first = Math.max(0, firstAtOrAfter(offsets, heightAt, viewport.top - OVERSCAN_PX));
  let last = first;
  while (last < rows.length && (offsets[last] ?? 0) < viewport.top + viewport.height + OVERSCAN_PX)
    last += 1;

  // 내용이 늘면 바닥에 붙어 있던 경우에만 따라 내려간다. 사용자가 위로 올렸으면 건드리지 않는다
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && followTail && stuck.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = (): void => {
    const el = scroller.current;
    if (el === null) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    setViewport({ top: el.scrollTop, height: el.clientHeight });
  };

  // 첫 렌더에서 뷰포트 높이를 읽는다
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && viewport.height === 0)
      setViewport({ top: el.scrollTop, height: el.clientHeight });
  }, [viewport.height]);

  const mounted = rows.slice(first, last);
  return (
    <div className="scroller" ref={scroller} onScroll={onScroll}>
      <div style={{ height: total, position: "relative" }}>
        {mounted.map((row, i) => (
          <div
            key={row.key}
            data-row-key={row.key}
            className="vrow"
            style={{ position: "absolute", top: offsets[first + i] ?? 0, left: 0, right: 0 }}
            ref={(el) => {
              if (el === null) return undefined;
              observer?.observe(el);
              return () => {
                observer?.unobserve(el);
              };
            }}
          >
            {renderRow(row)}
          </div>
        ))}
      </div>
    </div>
  );
}
