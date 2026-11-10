import { Button } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { nextStuck } from "./virtual-list-stick.ts";

// 가상 스크롤(L4.desktop.spec 4.10 수단 3). 화면에 보이는 행과 앞뒤 여유분만 DOM에 둔다.
// 행 높이는 고정하지 않는다(V7): 마운트된 행을 ResizeObserver로 재고, 재지 않은 행은 추정값을 쓴다.
// 이 부품의 상태(스크롤 위치, 잰 높이)는 이 부품만 읽으므로 전역 스토어에 두지 않는다(FS-04).

export type VirtualRow = { readonly key: string };

const ESTIMATED_HEIGHT = 96;
const OVERSCAN_PX = 600;
const STICK_THRESHOLD_PX = 48;
/** 목록 안쪽 위·아래 여백. 맨 위에서 첫 행이 헤더 구분선에, 맨 아래에서 마지막 행이 입력창에 붙지 않게 한다(행 아래의 pb-4는 따로 있다) */
const PAD_TOP_PX = 16;
const PAD_BOTTOM_PX = 8;

type Props<R extends VirtualRow> = {
  readonly rows: readonly R[];
  readonly renderRow: (row: R) => ReactNode;
  /** 바닥에 붙어 있을 때 새 내용이 오면 따라 내려간다 */
  readonly followTail: boolean;
  /** 스크롤 영역의 이름(화면 낭독이 영역으로 읽는다) */
  readonly label: string;
  /** 내가 보낸 마지막 말의 행 키. 이 값이 바뀌면(같은 목록 안에서) 위로 올려 둔 채여도 바닥으로 내려간다(scJ S2-2) */
  readonly ownTailKey?: string | null;
};

/** 진행 중 행의 키 접두사(transcript.tsx). 기록이 오면 이 행은 사라지고 같은 내용의 기록 행이 생긴다 */
const LIVE_PREFIX = "live:";

/** 바닥에 있던 때보다 늘어난 "새 메시지" 수. 진행 중 행은 기록 행이 생기기 전까지 하나로 센다 */
function unseenCount(keys: readonly string[], baseline: number): number {
  const recorded = keys.filter((key) => !key.startsWith(LIVE_PREFIX)).length;
  const grown = Math.max(0, recorded - baseline);
  return grown > 0 || recorded === keys.length ? grown : 1;
}

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
  // 직전에 잰 스크롤 위치와 내용 높이. 사용자가 움직인 것인지 nextStuck이 이것과 비교해 본다.
  // 프로그램이 위치를 옮긴 뒤에는 옮긴 자리로 갱신해, 그 스크롤 이벤트를 사용자의 움직임으로 잘못 보지 않게 한다
  const lastTop = useRef<number | null>(null);
  const lastScrollHeight = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  // 잰 높이. 렌더가 읽으므로 상태다. 관찰자 콜백은 모아 두었다가 프레임마다 한 번 반영한다
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const measured = useRef<Map<string, number>>(new Map());
  const frame = useRef<number | null>(null);
  // 가장 최근 그린 배치(관찰자 콜백이 읽는다)와, 화면 위쪽 행의 높이가 바뀐 만큼 스크롤을 옮겨 보이는 내용이 밀리지 않게 하는 보정량
  const latest = useRef<{
    keys: readonly string[];
    offsets: readonly number[];
    heights: ReadonlyMap<string, number>;
  }>({
    keys: [],
    offsets: [],
    heights: new Map(),
  });
  const pendingShift = useRef(0);
  // 한 번 화면 밖으로 나갔다 다시 들어오는 행은 들어오는 움직임(animate-rise)을 다시 하지 않는다
  const seen = useRef<Set<string>>(new Set());

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
        // 보이는 영역 위에 통째로 있는 행의 높이가 바뀌면 그만큼 스크롤을 옮긴다. 그렇지 않으면 위로 올릴 때마다 아래 내용이 밀려 튄다.
        // 바닥에 붙어 있으면 따라가기가 맡으므로 건드리지 않는다
        const el = scroller.current;
        if (el !== null && !stuck.current) {
          const view = latest.current;
          let shift = 0;
          for (const [key, height] of batch) {
            const index = view.keys.indexOf(key);
            if (index < 0) continue;
            const old = view.heights.get(key) ?? ESTIMATED_HEIGHT;
            if (PAD_TOP_PX + (view.offsets[index] ?? 0) + old <= el.scrollTop)
              shift += height - old;
          }
          pendingShift.current += shift;
        }
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

  const contentTop = viewport.top - PAD_TOP_PX;
  const first = Math.max(0, firstAtOrAfter(offsets, heightAt, contentTop - OVERSCAN_PX));
  let last = first;
  while (last < rows.length && (offsets[last] ?? 0) < contentTop + viewport.height + OVERSCAN_PX)
    last += 1;

  // 내용이 늘면 바닥에 붙어 있던 경우에만 따라 내려간다. 사용자가 위로 올렸으면 건드리지 않는다
  // 목록이 다른 대화의 것으로 바뀌면(첫 행 키가 달라지면) 이전 대화에서 위로 올려 둔 위치를 잇지 않고 다시 바닥에 붙는다(rtE R-11)
  // 내가 보내면(ownTailKey가 같은 목록 안에서 바뀌면) 바닥으로 간다. 남의 새 출력은 위로 올린 자리를 지키고 "새 메시지" 단추로 알린다(scJ S2-2)
  const firstKey = useRef<string | undefined>(undefined);
  const ownKey = useRef<string | null | undefined>(props.ownTailKey);
  const baseline = useRef(0);
  const [unseen, setUnseen] = useState(0);
  useLayoutEffect(() => {
    latest.current = { keys, offsets, heights };
    const el = scroller.current;
    const head = keys[0];
    const switched = firstKey.current !== undefined && head !== firstKey.current;
    if (switched) stuck.current = true;
    firstKey.current = head;
    const own = props.ownTailKey ?? null;
    if (!switched && own !== null && own !== ownKey.current) stuck.current = true;
    ownKey.current = own;
    if (el !== null && followTail && stuck.current) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
      lastScrollHeight.current = el.scrollHeight;
    }
    if (stuck.current) baseline.current = keys.filter((key) => !key.startsWith(LIVE_PREFIX)).length;
  });
  // 위쪽 행의 높이가 바뀐 만큼 스크롤을 옮긴다(관찰자 콜백이 정한 보정량). 높이 상태가 바뀐 렌더 직후, 그리기 전에 한다
  useLayoutEffect(() => {
    const el = scroller.current;
    const shift = pendingShift.current;
    pendingShift.current = 0;
    // 잰 높이가 없으면 보정할 것도 없다(heights는 이 효과가 높이 상태 갱신 직후에 도는 기준이다)
    if (heights.size === 0 || el === null || shift === 0 || stuck.current) return;
    el.scrollTop += shift;
    lastTop.current = el.scrollTop;
    lastScrollHeight.current = el.scrollHeight;
    setViewport({ top: el.scrollTop, height: el.clientHeight });
  }, [heights]);
  // 새 내용이나 스크롤이 있을 때마다 바닥에서 벗어난 채 늘어난 수를 다시 센다
  useLayoutEffect(() => {
    setUnseen(followTail && !stuck.current ? unseenCount(keys, baseline.current) : 0);
  }, [keys, followTail]);

  const onScroll = (): void => {
    const el = scroller.current;
    if (el === null) return;
    stuck.current = nextStuck({
      prevStuck: stuck.current,
      prevTop: lastTop.current,
      prevScrollHeight: lastScrollHeight.current,
      top: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      threshold: STICK_THRESHOLD_PX,
    });
    lastTop.current = el.scrollTop;
    lastScrollHeight.current = el.scrollHeight;
    setUnseen(followTail && !stuck.current ? unseenCount(keys, baseline.current) : 0);
    setViewport({ top: el.scrollTop, height: el.clientHeight });
  };

  // 휠을 위로 굴리면 스크롤 이벤트보다 먼저 바닥에서 벗어난 것으로 본다. 바닥 근처에서 조금만 올려도 다시 내려가 튀지 않게 한다
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const el = scroller.current;
    if (el !== null && event.deltaY < 0 && el.scrollTop > 0) stuck.current = false;
  };

  // 첫 렌더에서 뷰포트 높이를 읽는다
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && viewport.height === 0)
      setViewport({ top: el.scrollTop, height: el.clientHeight });
  }, [viewport.height]);

  const mounted = rows.slice(first, last);
  // 스크롤 영역은 키보드로 들어가 PageUp/PageDown/Home/End/방향키로 움직인다(scD 1-3). 브라우저가 초점 있는 스크롤 영역에 그 키를 준다
  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
      <div
        className="scroller"
        ref={scroller}
        onScroll={onScroll}
        onWheel={onWheel}
        tabIndex={0}
        role="region"
        aria-label={props.label}
      >
        <div style={{ height: total + PAD_TOP_PX + PAD_BOTTOM_PX, position: "relative" }}>
          {mounted.map((row, i) => (
            <div
              key={row.key}
              data-row-key={row.key}
              style={{
                position: "absolute",
                top: PAD_TOP_PX + (offsets[first + i] ?? 0),
                left: 0,
                right: 0,
              }}
              ref={(el) => {
                if (el === null) return undefined;
                // 이미 한 번 마운트됐던 행이면 들어오는 움직임을 끈다(styles.css). 속성은 첫 그림 전에 붙는다
                if (seen.current.has(row.key)) el.setAttribute("data-seen", "");
                observer?.observe(el);
                return () => {
                  observer?.unobserve(el);
                  seen.current.add(row.key);
                };
              }}
            >
              {renderRow(row)}
            </div>
          ))}
        </div>
      </div>
      {unseen > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 8,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <span style={{ pointerEvents: "auto" }}>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                const el = scroller.current;
                if (el === null) return;
                el.scrollTop = el.scrollHeight;
                lastTop.current = el.scrollTop;
                lastScrollHeight.current = el.scrollHeight;
                stuck.current = true;
                baseline.current = keys.filter((key) => !key.startsWith(LIVE_PREFIX)).length;
                setViewport({ top: el.scrollTop, height: el.clientHeight });
              }}
            >
              {t("desktop.transcript.newMessages", { count: unseen })}
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
