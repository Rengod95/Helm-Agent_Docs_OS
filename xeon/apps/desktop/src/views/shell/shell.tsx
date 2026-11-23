// S-01 앱 셸. 제목 띠 없음(DP-05). 왼쪽 패널(창 위아래 끝까지, 접으면 48px 아이콘 막대) | 가운데 무대(투명, 오른쪽 끝까지) | 오른쪽 떠 있는 막대 + well | 아래 상태 표시줄.
// 두 영역(대화, 작업대)은 이 셸 하나를 같이 쓰고 왼쪽 패널 내용과 오른쪽 탭만 바뀐다. 화면은 등록부(registry)가 준다.
import { MissingArt } from "../illustrations/index.tsx";
import { t } from "@fresnel/client/i18n";
import { EmptyState, Toaster } from "@caustic/react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Presence, fadeIn, flipFrom, useScreenEnter } from "../../lib/motion-presets.tsx";
import { cssPxOf, cssZoomOf } from "../../lib/zoom.ts";
import { currentEndTabOf, EndPanel, wellWidthOf } from "./end-panel.tsx";
import { wellBesideOf } from "./well-beside.ts";
import { useWellWide } from "./well-wide.ts";
import type { ContextProfile } from "./context-picker.tsx";
import { formatKey, resolveKeymap, type ActionId } from "./keybindings.ts";
import { runShellAction, resolveShortcut } from "./shortcuts.ts";
import type { ShellRegistry } from "./registry.ts";
import { StartPanel } from "./start-panel.tsx";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import {
  TOAST_BOTTOM_DEFAULT_PX,
  TOAST_DEFAULT_WIDTH_PX,
  TOAST_MIN_WIDTH_ACTION_PX,
  TOAST_MIN_WIDTH_PX,
  toastPlace,
  toastFit,
  cssBoxOf,
  type Box,
  type ToastFit,
  type ToastPlace,
} from "./toaster-slot.ts";
import { GoToThreadContext } from "../thread-link.ts";

const STAGE_ID = "stage";

export interface ShellProps {
  readonly registry: ShellRegistry;
  /** 사용자가 바꾼 바로 가기 키(`l4.desktop.appearance.keybindings`). 없으면 기본 표 */
  readonly keyOverrides?: Readonly<Record<string, string>> | undefined;
  readonly mac: boolean;
  /** 설정 화면이 무대를 채우는 중인가(두 영역 공통 화면) */
  readonly settingsOpen: boolean;
  readonly onSettingsOpenChange: (open: boolean) => void;
  /** 설정 화면 내용 */
  readonly settingsScreen: ReactNode;
  /** 대화 영역 왼쪽 대화 목록 슬롯 */
  readonly threadList: ReactNode;
  /** 맥락 칸의 프로필 목록. 프로필 화면 트랙이 준다 */
  readonly profiles?: readonly ContextProfile[] | undefined;
  /** 상태 표시줄 슬롯(S-03). 셸은 자리만 둔다 */
  readonly statusBar: ReactNode;
  /** 명령 팔레트 슬롯(S-02). `paletteOpen`일 때 그리는 것은 팔레트 쪽이다 */
  readonly palette?: ReactNode;
  /** 대화 상자가 열려 있으면 Esc를 셸이 쓰지 않는다 */
  readonly modalOpen?: boolean | undefined;
  /** 셸이 처리하지 않는 동작(`thread.new`, `turn.interrupt` 등) */
  readonly onAction?: ((id: ActionId) => void) | undefined;
  /** "대화로 가기"(승인 카드 등 대화 이름 링크): 그 대화를 대화 영역에서 연다 */
  readonly onGoToThread: (threadId: string) => void;
}

/** 폭 판정에 쓰는 CSS 픽셀 폭. 앱 확대는 `<html>`의 `zoom`이라 `innerWidth`가 그대로이므로 확대 비율로 나눈다(150%에서 733, 200%에서 550) */
export function layoutWidthOf(innerWidth: number, zoomStyle: string): number {
  const zoom = Number.parseFloat(zoomStyle);
  return Number.isFinite(zoom) && zoom > 0 ? innerWidth / zoom : innerWidth;
}

function useWindowResize(): void {
  const actions = useShellActions();
  useEffect(() => {
    const root = document.documentElement;
    const update = (): void => {
      actions.resize(layoutWidthOf(window.innerWidth, root.style.zoom));
    };
    update();
    window.addEventListener("resize", update);
    // 설정에서 확대를 바꾸면 창 크기는 그대로라 resize가 오지 않는다. `<html style>` 변화를 본다
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => {
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [actions]);
}

function useShellShortcuts(props: ShellProps): void {
  const actions = useShellActions();
  const keymap = useMemo(() => resolveKeymap(props.keyOverrides), [props.keyOverrides]);
  const { mac, settingsOpen, onSettingsOpenChange, onAction, modalOpen } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const model = actions.snapshot();
      if (e.key === "Escape" && !model.paletteOpen && modalOpen !== true) {
        actions.dismissFloating();
        return;
      }
      const id = resolveShortcut(keymap, e, mac);
      if (id === null) return;
      const handled = runShellAction(id, model, actions, {
        open: settingsOpen,
        set: onSettingsOpenChange,
      });
      if (handled) e.preventDefault();
      else if (onAction !== undefined) {
        e.preventDefault();
        onAction(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [actions, keymap, mac, settingsOpen, onSettingsOpenChange, onAction, modalOpen]);
}

/**
 * 무대: 지금 화면 하나. `keepAlive` 화면(DP-90)은 한 번 열면 내리지 않고, 지금 화면이 아닐 때 `hidden`으로 숨긴다
 * (플러그인 프레임과 화면 트리의 상태가 대화·설정·크래프트를 다녀와도 남는다)
 */
function Stage(props: {
  readonly registry: ShellRegistry;
  readonly settingsOpen: boolean;
  readonly settingsScreen: ReactNode;
}): ReactNode {
  const screen = useShell((s) => s.places[s.area].screen);
  const def = props.registry.screen(screen);
  const keptNow = !props.settingsOpen && def?.keepAlive === true;
  const [kept, setKept] = useState<readonly string[]>([]);
  if (keptNow && !kept.includes(screen)) setKept([...kept, screen]);
  let current: ReactNode = null;
  if (props.settingsOpen) current = props.settingsScreen;
  else if (def === undefined) {
    current = (
      <EmptyState media={<MissingArt />} surface="none" title={t("desktop.shell.screen.missing")} />
    );
  } else if (def.keepAlive !== true) current = def.render();
  return (
    <>
      {current}
      {kept.map((id) => {
        const shown = keptNow && id === screen;
        return (
          <div
            key={id}
            data-kept-screen={id}
            hidden={!shown}
            className={shown ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
          >
            {props.registry.screen(id)?.render()}
          </div>
        );
      })}
    </>
  );
}

/** 피할 곳 안에서 토스트가 덮으면 안 되는 조작부: 보내기·모델 고르기·승인 단추, 입력 칸 */
const AVOID_CONTROLS =
  'button, textarea, input, select, [contenteditable="true"], [role="combobox"]';

/** 화면의 피할 곳(`data-toast-avoid`: 입력창 묶음, 설정의 재시작 막대) 안 조작부의 상자. 보이지 않는 것(크기 0)은 뺀다 */
function avoidControlsOf(): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll("[data-toast-avoid]")) {
    if (el.getBoundingClientRect().height === 0) continue;
    for (const c of el.querySelectorAll(AVOID_CONTROLS)) {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(r);
    }
  }
  return out;
}

/** 화면의 피할 곳 상자(입력창 묶음 전체, 재시작 막대). 토스트를 올릴 때 이 위쪽 끝 위에 둔다(AGE-75) */
function avoidRegionsOf(): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll("[data-toast-avoid]")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(r);
  }
  return out;
}

/** 가운데 아래 자리(compact)의 좌우 여백(0.5rem) */
const CENTER_INSET_PX = 8;

const DEFAULT_FIT: ToastFit = {
  width: TOAST_DEFAULT_WIDTH_PX,
  bottom: TOAST_BOTTOM_DEFAULT_PX,
  shift: 0,
};

/**
 * 토스트의 폭과 아래 간격(DP-157, DP-170, AGE-75, `toastFit`). 기본은 폭 360, 아래 40이다. 그 자리의 토스트가 피할 곳의 조작부와 겹치면
 * 오른쪽 자리는 폭을 오른쪽 틈까지 줄이고, 틈이 최소 폭(200, 동작 단추가 있으면 280)보다 좁거나 가운데 아래 자리면 입력창 묶음 위로 올린다.
 * 올린 토스트가 오른쪽 떠 있는 막대와 겹치면 막대 왼쪽으로 옮긴다(`shift`).
 * 크기, 화면, 토스트 수가 바뀌면 다시 잰다. 대화가 흐르는 동안 DOM이 자주 바뀌므로 한 프레임에 한 번만 잰다
 */
function useToastFit(place: ToastPlace): ToastFit {
  const [fit, setFit] = useState(DEFAULT_FIT);
  // 기본 자리의 오른쪽 끝(창 끝에서 잰 px). 잰 토스트 상자는 옮긴 뒤의 자리라 쓰지 않는다(옮김이 다음 잼에 되먹지 않게)
  const endPx = place.kind === "end" ? place.endPx : CENTER_INSET_PX;
  const shrink = place.kind === "end";
  useEffect(
    () =>
      watchToastFit(shrink, endPx, (next) => {
        setFit((prev) =>
          prev.width === next.width && prev.bottom === next.bottom && prev.shift === next.shift
            ? prev
            : next,
        );
      }),
    [shrink, endPx],
  );
  return fit;
}

/** 토스트 자리를 재어 `onFit`으로 알리고, 크기·DOM이 바뀔 때마다 다시 잰다. 돌려준 함수가 지켜보기를 멈춘다 */
function watchToastFit(shrink: boolean, endPx: number, onFit: (fit: ToastFit) => void): () => void {
  let frame = 0;
  const measure = (): void => {
    frame = 0;
    const region = document.querySelector('[data-slot="toast-viewport"]');
    if (region === null) return;
    const box = region.getBoundingClientRect();
    const action = region.querySelector('[data-slot="toast-action"]') !== null;
    // 잰 상자와 창 높이는 화면 px, 토스트 폭·간격은 CSS px라 앱 확대로 나눠 맞춘다(DP-173)
    const zoom = cssZoomOf(region);
    const rail = document.querySelector("[data-end-bar]")?.getBoundingClientRect();
    onFit(
      toastFit({
        controls: avoidControlsOf().map((c) => cssBoxOf(c, zoom)),
        regions: avoidRegionsOf().map((c) => cssBoxOf(c, zoom)),
        rails: rail === undefined || rail.width === 0 ? [] : [cssBoxOf(rail, zoom)],
        left: CENTER_INSET_PX,
        right: cssPxOf(window.innerWidth, zoom) - endPx,
        height: cssPxOf(box.height, zoom),
        viewportHeight: cssPxOf(window.innerHeight, zoom),
        minWidth: action ? TOAST_MIN_WIDTH_ACTION_PX : TOAST_MIN_WIDTH_PX,
        shrink,
      }),
    );
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  measure();
  const resize = new ResizeObserver(schedule);
  resize.observe(document.body);
  const watch = (): void => {
    for (const el of document.querySelectorAll(
      '[data-toast-avoid], [data-slot="toast-viewport"]',
    )) {
      resize.observe(el);
    }
  };
  watch();
  const mutate = new MutationObserver(() => {
    watch();
    schedule();
  });
  mutate.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  return () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    resize.disconnect();
    mutate.disconnect();
    window.removeEventListener("resize", schedule);
  };
}

function ShellToaster(props: { readonly registry: ShellRegistry }): ReactNode {
  const layout = useShell((s) => s.layout);
  const open = useShell((s) => s.endOpen);
  const area = useShell((s) => s.area);
  const tabId = useShell((s) => s.places[s.area].endTab);
  const screen = useShell((s) => s.places[s.area].screen);
  const tabs = props.registry.endTabs(area, screen);
  const pluginTabs = props.registry.pluginEndTabs(area, screen);
  const wide = useWellWide();
  const place = toastPlace(
    layout,
    open,
    wellWidthOf(currentEndTabOf(tabs, pluginTabs, tabId), wide),
  );
  const fit = useToastFit(place);
  const bottom = fit.bottom;
  const width = fit.width;
  // DP-152 자리는 창 전체 기준 오른쪽 아래(끝에서 16px), 상태 표시줄 위다. 입력창 묶음·재시작 막대(`data-toast-avoid`)의 조작부와 겹치면
  // 폭을 줄여 그 오른쪽 틈에 둔다(DP-157). 틈이 200(동작 단추가 있으면 280)보다 좁으면 입력창 묶음 위쪽 끝 위 8px로 올린다(AGE-75, `toastFit`).
  // 가운데 아래(compact)는 폭을 바꾸지 않고, 입력창 묶음과 겹치면 같은 규칙으로 올린다
  // 모양(outline)과 사라짐 시간은 caustic 기본값이다(DP-151, DP-153). 오류 토스트는 닫을 때까지 남는다
  return (
    <Toaster
      label={t("desktop.shell.toast.label")}
      className="transition-[inset] duration-quick"
      style={
        place.kind === "center-bottom"
          ? {
              insetInlineStart: `${String(CENTER_INSET_PX)}px`,
              insetInlineEnd: `${String(CENTER_INSET_PX + fit.shift)}px`,
              bottom,
            }
          : {
              insetInlineEnd: `${String(place.endPx + fit.shift)}px`,
              bottom,
              width: `${String(width)}px`,
            }
      }
    />
  );
}

/** 대화 화면이 비킬 오른쪽 여백을 담는 CSS 변수(styles.css AGE-75) */
type WellBesideStyle = CSSProperties & { readonly "--well-beside": string };

function wellBesideStyle(px: number): WellBesideStyle {
  return { "--well-beside": `${String(px)}px` };
}

/** 요소의 폭(CSS px, 앱 확대를 되돌린 값). 크기가 바뀌면 다시 잰다. 처음 그리기 전에는 0이다 */
function useCssWidth(ref: { readonly current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = (): void => {
      setWidth(cssPxOf(el.getBoundingClientRect().width, cssZoomOf(el)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}

/** 셸 전체가 "대화로 가기"를 무대와 끝 영역(받은 요청 등)에 내린다. 셸 본문은 `ShellFrame`이 그린다 */
export function Shell(props: ShellProps): ReactNode {
  return (
    <GoToThreadContext value={props.onGoToThread}>
      <ShellFrame {...props} />
    </GoToThreadContext>
  );
}

function ShellFrame(props: ShellProps): ReactNode {
  const actions = useShellActions();
  const layout = useShell((s) => s.layout);
  const startOpen = useShell((s) => s.startOpen);
  const railArea = useShell((s) => s.area);
  const railScreen = useShell((s) => s.places[s.area].screen);
  // 무대는 오른쪽 끝까지 찬다(DP-68). 오른쪽 막대는 그 위에 떠 있고, 겹치는 곳만 피한다:
  // 막대는 머리 줄 아래 본문의 세로 가운데에 서고(DP-135) 머리 줄은 끝까지 쓴다. 머리 뒤 본문은 막대 자리만큼 안쪽 여백을 두고(styles.css DP-68),
  // 막대는 창 끝에서 12px 떨어져 스크롤 막대를 덮지 않는다(end-panel.tsx)
  const hasRail =
    props.registry.endTabs(railArea, railScreen).length > 0 ||
    props.registry.pluginEndTabs(railArea, railScreen).length > 0;
  // 끝까지 쓰는 화면(등록의 `bleed`, 크래프트 개요와 리뷰)은 무대 가장자리까지 깔린다. 셸은 여백과 막대 자리 비우기를 두지 않고,
  // 막대와 겹치는 칸은 화면이 스스로 비킨다(`rail-avoid.ts`). 설정 화면은 화면 등록과 따로 그려지므로 늘 셸의 여백을 받는다
  const bleed = !props.settingsOpen && props.registry.screen(railScreen)?.bleed === true;
  useWindowResize();
  useShellShortcuts(props);
  const keymap = useMemo(() => resolveKeymap(props.keyOverrides), [props.keyOverrides]);
  const keyLabel = (id: ActionId): string => formatKey(keymap[id], props.mac);
  const compact = layout === "compact";
  const columnRef = useRef<HTMLDivElement | null>(null);
  // AGE-75: well이 열리면 대화 화면은 well 자리만큼 비킨다(`well-beside.ts`). 무대 폭은 무대 열의 폭이다(well과 막대는 그 위에 떠 있어 폭을 바꾸지 않는다)
  const stageWidth = useCssWidth(columnRef);
  const endOpen = useShell((s) => s.endOpen);
  const endTabId = useShell((s) => s.places[s.area].endTab);
  const wellWide = useWellWide();
  const wellBeside =
    !compact &&
    endOpen &&
    hasRail &&
    !bleed &&
    !props.settingsOpen &&
    props.registry.screen(railScreen)?.wellBeside === true
      ? wellBesideOf(
          stageWidth,
          wellWidthOf(
            currentEndTabOf(
              props.registry.endTabs(railArea, railScreen),
              props.registry.pluginEndTabs(railArea, railScreen),
              endTabId,
            ),
            wellWide,
          ),
        )
      : null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  // 화면 전환(DP-106): 영역·화면·설정을 바꾸면 무대가 투명도 + 8px 오름으로 들어온다(fade-through). 옛 화면은 바로 사라진다
  const screenKey = props.settingsOpen ? "settings" : `${railArea}:${railScreen}`;
  const stageRef = useScreenEnter<HTMLElement>(screenKey);
  // 왼쪽 패널 접기·펴기(DP-106): 폭은 한 번에 바뀌고, 무대 열은 옛 자리에서 transform으로 미끄러져 온다(FLIP). 배치는 한 번만 다시 흐른다.
  // 패널 내용(막대 ↔ 목록)은 투명도로 나타난다. 위치는 그릴 때마다 재 두어 다음 접기의 출발점으로 쓴다
  const lastLeft = useRef<number | null>(null);
  const lastOpen = useRef(startOpen);
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (column === null) return;
    const left = column.getBoundingClientRect().left;
    if (!compact && lastOpen.current !== startOpen && lastLeft.current !== null) {
      // 자리는 화면 px이라 확대로 나눠 transform의 CSS px로 옮긴다(DP-173)
      flipFrom(column, cssPxOf(lastLeft.current - left, cssZoomOf(column)));
      const panel = panelRef.current;
      if (panel !== null) {
        fadeIn(
          panel.querySelectorAll(
            "[data-slot=side-panel-header-content], [data-slot=side-panel-body], [data-slot=side-panel-footer] > *",
          ),
        );
      }
    }
    lastOpen.current = startOpen;
    lastLeft.current = left;
  });
  const navigate = (screen: string): void => {
    props.onSettingsOpenChange(false);
    actions.updatePlace({ screen, scroll: 0 });
    if (compact) actions.setStartOpen(false);
  };
  const startPanel = (
    <StartPanel
      registry={props.registry}
      floating={compact}
      settingsOpen={props.settingsOpen}
      onOpenSettings={() => {
        props.onSettingsOpenChange(true);
        if (compact) actions.setStartOpen(false);
      }}
      onNavigate={navigate}
      onSwitchArea={(area) => {
        props.onSettingsOpenChange(false);
        actions.switchArea(area);
      }}
      threadList={props.threadList}
      profiles={props.profiles ?? []}
      onNewThread={() => {
        if (compact) actions.setStartOpen(false);
        props.onAction?.("thread.new");
      }}
      keyLabel={keyLabel}
    />
  );
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-bg-app"
      // 창 틀(DP-80): 창 왼쪽 끝에 무엇이 붙어 있는지. 신호등 자리를 머리 줄 중 누가 비울지 styles.css가 이 값으로 정한다
      data-start-edge={compact ? "none" : startOpen ? "panel" : "rail"}
    >
      <a
        href={`#${STAGE_ID}`}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(STAGE_ID)?.focus();
        }}
        className="absolute top-2 left-2 z-40 -translate-y-[200%] rounded-lg bg-control-raised px-3 py-2 text-ui-strong text-text-primary opacity-0 outline-none focus:translate-y-0 focus:opacity-100 focus-visible:focus-ring"
      >
        {t("desktop.shell.skip")}
      </a>
      {/* 접기·펴기 동안 무대 열이 창 밖으로 미끄러지는 부분을 자른다 */}
      <div className="relative flex min-h-0 flex-1 overflow-clip">
        {compact ? (
          // 좁은 폭: 떠 있는 패널은 왼쪽에서 미끄러져 들어오고 나갈 때도 미끄러져 나간다(DP-106)
          <Presence
            show={startOpen}
            variant="panelStart"
            className="absolute inset-y-0 start-0 z-30 flex w-[min(20rem,calc(100%-3rem))]"
          >
            {startPanel}
          </Presence>
        ) : (
          // 무대 열이 접기·펴기 동안 패널 밑으로 미끄러지므로 패널이 위에 온다
          <div ref={panelRef} className="relative z-10 flex">
            {startPanel}
          </div>
        )}
        <div ref={columnRef} className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            <main
              ref={stageRef}
              id={STAGE_ID}
              tabIndex={-1}
              aria-label={t("desktop.shell.stage.label")}
              data-rail={hasRail && !bleed ? "" : undefined}
              // 대화 기록과 입력창 묶음(`data-chat-rail-gap`)이 이만큼 오른쪽을 비운다(styles.css AGE-75)
              data-well-beside={wellBeside === null ? undefined : ""}
              style={wellBeside === null ? undefined : wellBesideStyle(wellBeside)}
              // `--stage-rail`: 머리 뒤 본문의 오른쪽 여백(막대 34 + 창 끝 12 → 48, styles.css DP-68). `--shell-rail`: 같은 값을 본문 밖에서 읽는 화면용(플레이그라운드)
              className={`flex min-w-0 flex-1 flex-col outline-none ${hasRail && !bleed ? "[--shell-rail:calc(var(--spacing)*12)] [--stage-rail:calc(var(--spacing)*12)]" : ""}`}
            >
              <Stage
                registry={props.registry}
                settingsOpen={props.settingsOpen}
                settingsScreen={props.settingsScreen}
              />
            </main>
            <EndPanel registry={props.registry} keyLabel={keyLabel} beside={wellBeside !== null} />
          </div>
          {props.statusBar}
        </div>
      </div>
      <ShellToaster registry={props.registry} />
      {props.palette}
    </div>
  );
}
