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
import { flushSync } from "react-dom";
import { nextStuck } from "./virtual-list-stick.ts";
import { useEdgeFade } from "./virtual-list-edge.ts";
import { glideStep, shouldGlide } from "./virtual-list-glide.ts";
import { anchorShiftOf, releasesOnExpand, unseenOf } from "./virtual-list-anchor.ts";
import { isMotionReduced } from "../lib/motion-presets.tsx";

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
  /** "새 메시지"로 셀 행. 없으면 모든 행이다. 진행 중 행과 그 기록 행은 키가 같아 하나로 센다 */
  readonly countRow?: (row: R) => boolean;
  /** 행 요소가 처음 마운트될 때 한 번 부른다(같은 요소가 다시 그려질 때는 부르지 않는다). 들어옴 움직임을 건다 */
  readonly onRowMount?: (row: R, el: HTMLElement) => void;
};

const countAll = (): boolean => true;

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
  useEdgeFade(scroller);
  const stuck = useRef(true);
  // 직전에 잰 스크롤 위치와 내용 높이. 사용자가 움직인 것인지 nextStuck이 이것과 비교해 본다.
  // 프로그램이 위치를 옮긴 뒤에는 옮긴 자리로 갱신해, 그 스크롤 이벤트를 사용자의 움직임으로 잘못 보지 않게 한다
  const lastTop = useRef<number | null>(null);
  const lastScrollHeight = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  // 잰 높이. 렌더가 읽으므로 상태다. 관찰자 콜백이 같은 프레임에 반영한다
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const measured = useRef<Map<string, number>>(new Map());
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
  // 따라 내려가기 보간(DP-106). 도는 동안의 프레임 번호와 직전 시각. 사용자가 위로 움직이면(바닥에서 벗어나면) 다음 프레임에서 멈춘다
  const glide = useRef<number | null>(null);
  const glideAt = useRef(0);
  // 마운트를 알린 요소. ref 콜백은 렌더마다 다시 불리므로 같은 요소에 두 번 알리지 않는다
  const reported = useRef<WeakSet<Element>>(new WeakSet());
  const countRow = props.countRow ?? countAll;

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
      // 잰 높이는 같은 프레임에 반영한다(flushSync). 관찰자 콜백은 그리기 전에 불리므로, 높이가 바뀐 줄 아래 줄들이
      // 한 프레임 늦게 옮겨져 겹치거나 틈이 벌어지는 일이 없다(펼침 높이 잇기, 확정 때 줄이 나뉨, dzM2 시안 §10)
      {
        const batch = measured.current;
        measured.current = new Map();
        // 보이는 영역 위에 통째로 있는 행의 높이가 바뀌면 그만큼 스크롤을 옮긴다. 그렇지 않으면 위로 올릴 때마다 아래 내용이 밀려 튄다.
        // 바닥에 붙어 있으면 따라가기가 맡으므로 건드리지 않는다
        const el = scroller.current;
        if (el !== null && !stuck.current) {
          const view = latest.current;
          pendingShift.current += anchorShiftOf({
            batch,
            keys: view.keys,
            offsets: view.offsets,
            heights: view.heights,
            scrollTop: el.scrollTop,
            padTop: PAD_TOP_PX,
            estimate: ESTIMATED_HEIGHT,
          });
        }
        flushSync(() => {
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
      }
    });
    setObserver(created);
    return () => {
      created.disconnect();
    };
  }, []);

  const stopGlide = (): void => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
  };
  // 한 프레임: 지금의 바닥(내용이 계속 늘면 목표도 따라 늘어난다)으로 남은 거리의 일부만큼 간다. 옮긴 자리를 lastTop에 적어
  // 이 스크롤 이벤트를 사용자의 움직임으로 보지 않게 한다. 바닥에서 벗어났으면(위로 굴림) 그 자리에서 놓는다
  function glideFrame(now: number): void {
    const el = scroller.current;
    glide.current = null;
    if (el === null || !stuck.current) return;
    const target = el.scrollHeight - el.clientHeight;
    const next = glideStep(el.scrollTop, target, now - glideAt.current);
    glideAt.current = now;
    el.scrollTop = next;
    lastTop.current = el.scrollTop;
    lastScrollHeight.current = el.scrollHeight;
    if (el.scrollHeight - el.clientHeight - el.scrollTop >= 1)
      glide.current = requestAnimationFrame(glideFrame);
  }
  useEffect(() => stopGlide, []);

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
  const baseline = useRef<ReadonlySet<string>>(new Set());
  const [unseen, setUnseen] = useState(0);
  useLayoutEffect(() => {
    latest.current = { keys, offsets, heights };
    const el = scroller.current;
    const head = keys[0];
    const switched = firstKey.current !== undefined && head !== firstKey.current;
    if (switched) stuck.current = true;
    firstKey.current = head;
    const own = props.ownTailKey ?? null;
    const ownBefore = ownKey.current;
    if (!switched && own !== null && own !== ownKey.current) stuck.current = true;
    ownKey.current = own;
    if (el !== null && followTail && stuck.current) {
      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      // 대화를 바꿨거나 내가 보냈거나 한 화면 넘게 늘었으면 바로 바닥으로 간다. 그 밖의 늘어남은 감쇠 보간으로 따라간다
      const jump =
        switched ||
        (own !== null && own !== ownBefore) ||
        !shouldGlide({ distance, viewportHeight: el.clientHeight, reduced: isMotionReduced() });
      if (jump) {
        stopGlide();
        el.scrollTop = el.scrollHeight;
        lastTop.current = el.scrollTop;
        lastScrollHeight.current = el.scrollHeight;
      } else if (glide.current === null) {
        glideAt.current = performance.now();
        glide.current = requestAnimationFrame(glideFrame);
      }
    }
    if (stuck.current) baseline.current = new Set(keys);
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
    setUnseen(followTail && !stuck.current ? unseenOf(rows, baseline.current, countRow) : 0);
  }, [rows, followTail, countRow]);
  // 스크롤 영역의 높이가 바뀌면(입력창이 자람, 창 크기) 바닥에 붙어 있을 때 같은 프레임에 바닥을 지킨다. 마지막 줄이 입력창 뒤로 숨지 않는다
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null || typeof ResizeObserver === "undefined") return undefined;
    let height = el.clientHeight;
    const resize = new ResizeObserver(() => {
      if (el.clientHeight === height) return;
      height = el.clientHeight;
      if (stuck.current && followTail) {
        el.scrollTop = el.scrollHeight;
        lastTop.current = el.scrollTop;
        lastScrollHeight.current = el.scrollHeight;
      }
      setViewport({ top: el.scrollTop, height: el.clientHeight });
    });
    resize.observe(el);
    return () => {
      resize.disconnect();
    };
  }, [followTail]);

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
    setUnseen(followTail && !stuck.current ? unseenOf(rows, baseline.current, countRow) : 0);
    setViewport({ top: el.scrollTop, height: el.clientHeight });
  };

  // 바닥에 붙은 채 마지막이 아닌 줄을 펼치면 붙음을 푼다(따라 내려가면 누른 줄 머리가 위로 밀려 나간다)
  const onClickCapture = (event: { readonly target: EventTarget }): void => {
    if (!stuck.current || !(event.target instanceof Element)) return;
    const toggle = event.target.closest("[aria-expanded]");
    if (toggle === null) return;
    const rowKey = toggle.closest("[data-row-key]")?.getAttribute("data-row-key") ?? null;
    if (
      releasesOnExpand({
        opening: toggle.getAttribute("aria-expanded") === "false",
        rowKey,
        lastKey: keys.at(-1),
      })
    ) {
      stuck.current = false;
      stopGlide();
    }
  };

  // 휠을 위로 굴리면 스크롤 이벤트보다 먼저 바닥에서 벗어난 것으로 본다. 바닥 근처에서 조금만 올려도 다시 내려가 튀지 않게 한다
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const el = scroller.current;
    if (el !== null && event.deltaY < 0 && el.scrollTop > 0) {
      stuck.current = false;
      stopGlide();
    }
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
        onClickCapture={onClickCapture}
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
                // 새 요소면 한 번 알린다(들어옴을 돌릴지는 부르는 쪽이 키로 정한다). 첫 그림 전에 불린다
                if (!reported.current.has(el)) {
                  reported.current.add(el);
                  props.onRowMount?.(row, el);
                }
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
      {unseen > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "var(--cs-space-2)",
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
                stopGlide();
                el.scrollTop = el.scrollHeight;
                lastTop.current = el.scrollTop;
                lastScrollHeight.current = el.scrollHeight;
                stuck.current = true;
                baseline.current = new Set(keys);
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
