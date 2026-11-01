// N-50 접근성 덧그림(목업 전용). 실제 앱에는 초점 순서 번호표·자막이 없다. 있는 것은 초점 고리, 영역 이동 키, aria-live 영역뿐이다.
// - regionOf/targetOf: 초점 정류장 다섯(§4.8, Y14)을 셸 DOM에서 찾는다(caustic data-slot과 셸 랜드마크).
// - FocusOverlay: 정류장마다 점선 틀 + 번호표. 지금 정류장만 진한 번호표(accent 면 하나).
// - LiveCaptions: 화면 낭독기가 읽는 문장을 개발용 자막으로(오른쪽 아래). 실제 읽기는 LiveRegion(sr-only, polite/alert)이 한다.
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { L, L2, STAGE_ID, T, type Area } from "../../_shell";
import type { Cap } from "../flow";

export const STOPS = 5;

export function stopLabel(n: number, area: Area): string {
  switch (n) {
    case 1:
      return L2("영역 바꾸기", "Area switch");
    case 2:
      return area === "workbench"
        ? L2(`${T.context} 칸`, `${T.context} field`)
        : L2("내비 · 대화 목록", "Navigation · conversation list");
    case 3:
      return L2("가운데", "Center");
    case 4:
      return L2("오른쪽 패널", "Right panel");
    default:
      return L2("상태 표시줄", "Status bar");
  }
}

export function regionOf(n: number): HTMLElement | null {
  const panel = document.querySelector<HTMLElement>('[data-slot="side-panel"]');
  switch (n) {
    case 1:
      return panel?.querySelector<HTMLElement>('[data-slot="segmented-control"]') ?? null;
    case 2: {
      // 작업대는 패널 머리의 보기 기준 칸 줄, 대화는 패널 본문(내비·대화 목록).
      const ctx = panel?.querySelector<HTMLElement>(
        `[data-slot="side-panel-header"] [aria-label="${T.context}"]`,
      );
      const row = ctx?.parentElement?.closest<HTMLElement>(".flex") ?? null;
      return row ?? panel?.querySelector<HTMLElement>('[data-slot="side-panel-body"]') ?? null;
    }
    case 3:
      return document.getElementById(STAGE_ID);
    case 4:
      return document.querySelector<HTMLElement>(`aside[aria-label="${L("맥락 패널")}"]`);
    default:
      return document.querySelector<HTMLElement>('[data-slot="status-bar"]');
  }
}

/** 정류장에 들어갈 때 초점을 받을 요소. 3은 기다리는 승인 카드가 있으면 그 카드, 없거나 composer면 입력창. */
export function targetOf(n: number, composer: boolean): HTMLElement | null {
  const panel = document.querySelector<HTMLElement>('[data-slot="side-panel"]');
  switch (n) {
    case 1:
      return (
        panel?.querySelector<HTMLElement>(
          '[data-slot="segmented-control-item"][data-state="checked"], [data-slot="segmented-control-item"][aria-checked="true"]',
        ) ?? null
      );
    case 2:
      return (
        panel?.querySelector<HTMLElement>(
          `[data-slot="side-panel-header"] [aria-label="${T.context}"]`,
        ) ??
        panel?.querySelector<HTMLElement>('[data-slot="side-panel-body"] [aria-current="page"]') ??
        panel?.querySelector<HTMLElement>(
          '[data-slot="side-panel-body"] button, [data-slot="side-panel-body"] a',
        ) ??
        null
      );
    case 3: {
      const main = document.getElementById(STAGE_ID);
      const card = main?.querySelector<HTMLElement>('[data-slot="agent-request"][tabindex]');
      if (card !== null && card !== undefined && !composer) return card;
      return main?.querySelector<HTMLElement>("textarea") ?? main ?? null;
    }
    case 4: {
      const aside = regionOf(4);
      return (
        aside?.querySelector<HTMLElement>('[role="region"] button') ??
        aside?.querySelector<HTMLElement>('[data-slot="floating-bar-item"]') ??
        null
      );
    }
    default:
      return regionOf(5)?.querySelector<HTMLElement>("button") ?? null;
  }
}

/** 초점이 들어간 요소가 어느 정류장인지(Tab으로 움직일 때 덧그림을 따라가게). */
export function stopOfElement(el: Element | null): { stop: number; composer: boolean } {
  if (el === null) return { stop: 0, composer: false };
  for (let n = 1; n <= STOPS; n++) {
    const r = regionOf(n);
    if (r?.contains(el) === true) return { stop: n, composer: el.tagName === "TEXTAREA" };
  }
  // 보기 기준 칸은 패널 머리 안이지만 정류장 2로 센다.
  return { stop: 0, composer: false };
}

/** 목업 스크린숏에서 프로그램 초점도 고리가 보이게: 지금 요소에 data-sim-focus를 단다(mockup.css). */
export function simFocus(el: HTMLElement | null): void {
  for (const x of document.querySelectorAll("[data-sim-focus]"))
    x.removeAttribute("data-sim-focus");
  if (el === null) return;
  el.focus({ preventScroll: true });
  el.setAttribute("data-sim-focus", "");
}

/** 번호표 자리: 컨트롤을 가리지 않게 틀 왼쪽 위 바깥(점선 모서리 위). 예외 둘:
 *  대화 영역 2(패널 본문은 스크롤 상자라 바깥이 잘림)는 틀 안 왼쪽 아래 빈 곳,
 *  5(상태 표시줄은 overflow hidden)는 띠 바로 위 바깥(부모 열에 붙임). */
function badgePlace(n: number, area: Area): string {
  if (n === 2 && area === "chat") return "bottom-0.5 start-1";
  if (n === 5) return "bottom-7 start-2";
  return "-top-2.5 start-1";
}

/** 정류장마다 그 요소 안에 틀을 포털로 넣는다(측정 없이 CSS로 따라가게: 창 크기가 바뀌어도 맞음). 목업 전용. */
export function FocusOverlay({ stop, area }: { stop: number; area: Area }) {
  const [els, setEls] = useState<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const read = () => {
      const next = Array.from({ length: STOPS }, (_, i) => regionOf(i + 1));
      for (const el of next)
        if (el !== null && getComputedStyle(el).position === "static")
          el.style.position = "relative";
      setEls((prev) =>
        prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next,
      );
    };
    read();
    const id = window.setInterval(read, 300);
    return () => window.clearInterval(id);
  }, [area]);
  return (
    <>
      {els.map((el, i) => {
        if (el === null) return null;
        const n = i + 1;
        const on = n === stop;
        const badge = (
          <span
            key={`b-${n}`}
            aria-hidden
            className={`pointer-events-none absolute z-40 ${badgePlace(n, area)} inline-flex h-4.5 items-center gap-1 rounded-full px-1.5 text-ui-xs font-semibold whitespace-nowrap shadow-1 ${
              on ? "bg-accent-solid text-accent-on" : "bg-surface-raised text-text-secondary"
            }`}
          >
            <span className="tabular-nums">{n}</span>
            <span className="font-normal">{stopLabel(n, area)}</span>
          </span>
        );
        const host = n === 5 ? el.parentElement : null;
        if (host !== null && getComputedStyle(host).position === "static")
          host.style.position = "relative";
        return (
          <Fragment key={n}>
            {createPortal(
              <div
                aria-hidden
                data-focus-stop={n}
                className={`pointer-events-none absolute inset-0 z-40 rounded-lg border border-dashed ${on ? "border-accent-graphic" : "border-border-strong"}`}
              >
                {host === null && badge}
              </div>,
              el,
              `stop-${n}`,
            )}
            {host !== null && createPortal(badge, host, `badge-${n}`)}
          </Fragment>
        );
      })}
    </>
  );
}

/** 실제 aria-live 영역(보이지 않음). 마지막 polite 문장과 마지막 alert 문장을 따로 둔다. */
export function LiveRegion({ caps }: { caps: Cap[] }) {
  const polite = [...caps].reverse().find((c) => c.kind === "polite");
  const alert = [...caps].reverse().find((c) => c.kind === "alert");
  return (
    <>
      <div aria-live="polite" className="sr-only">
        {polite?.text}
      </div>
      <div role="alert" className="sr-only">
        {alert?.text}
      </div>
    </>
  );
}

/** 개발용 자막(목업 전용): 낭독 문장과 그 종류. 맨 아래가 최신. */
export function LiveCaptions({ caps, extra }: { caps: Cap[]; extra?: string[] }) {
  return (
    <div
      role="region"
      aria-label="목업 전용 낭독 자막"
      className="fixed end-3 bottom-10 z-50 grid w-[22rem] max-w-[calc(100vw-1.5rem)] gap-1 rounded-lg bg-ink-solid p-2.5 text-ui-xs text-ink-on shadow-3"
    >
      <span className="opacity-70">
        {L2("목업 전용 · 화면 낭독기가 읽는 문장", "Mockup only · what a screen reader announces")}
      </span>
      {caps.length === 0 && (extra === undefined || extra.length === 0) && (
        <span className="opacity-70">
          {L2(
            "아직 읽은 문장이 없어요. 초점 이동은 요소 이름으로 읽혀요(live 아님)",
            "Nothing announced yet. Focus moves are read as element names (not live)",
          )}
        </span>
      )}
      {caps.map((c) => (
        <span key={c.n} className="flex gap-1.5">
          <span className="w-12 flex-none font-mono opacity-60">
            {c.kind === "alert" ? "alert" : "polite"}
          </span>
          <span className="min-w-0">{c.text}</span>
        </span>
      ))}
      {extra?.map((x) => (
        <span key={x} className="flex gap-1.5">
          <span className="w-12 flex-none font-mono opacity-60">note</span>
          <span className="min-w-0">{x}</span>
        </span>
      ))}
    </div>
  );
}
