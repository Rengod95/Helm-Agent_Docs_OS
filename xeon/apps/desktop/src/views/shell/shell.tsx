// S-01 앱 셸. 제목 띠 없음(DP-05). 왼쪽 패널(창 위아래 끝까지) | 가운데 무대(투명) | 오른쪽 떠 있는 막대 + well | 아래 상태 표시줄.
// 두 영역(대화, 작업대)은 이 셸 하나를 같이 쓰고 왼쪽 패널 내용과 오른쪽 탭만 바뀐다. 화면은 등록부(registry)가 준다.
import { t } from "@fresnel/client/i18n";
import { EmptyState, IconButton, Toaster } from "@caustic/react";
import { PanelLeft } from "@caustic/react/icons";
import { useEffect, useMemo, type ReactNode } from "react";
import { EndPanel, wellWidthOf } from "./end-panel.tsx";
import type { ContextProfile } from "./context-picker.tsx";
import { resolveKeymap, type ActionId } from "./keybindings.ts";
import { runShellAction, resolveShortcut } from "./shortcuts.ts";
import type { ShellRegistry } from "./registry.ts";
import { StartPanel } from "./start-panel.tsx";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import { toastPlace } from "./toaster-slot.ts";
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
  /** "대화로 가기": 맥락 대화를 대화 영역에서 연다 */
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

function Stage(props: {
  readonly registry: ShellRegistry;
  readonly settingsOpen: boolean;
  readonly settingsScreen: ReactNode;
}): ReactNode {
  const screen = useShell((s) => s.places[s.area].screen);
  if (props.settingsOpen) return props.settingsScreen;
  const def = props.registry.screen(screen);
  if (def !== undefined) return def.render();
  return <EmptyState surface="none" title={t("desktop.shell.screen.missing")} />;
}

function ShellToaster(props: { readonly registry: ShellRegistry }): ReactNode {
  const layout = useShell((s) => s.layout);
  const open = useShell((s) => s.endOpen);
  const area = useShell((s) => s.area);
  const tabId = useShell((s) => s.places[s.area].endTab);
  const screen = useShell((s) => s.places[s.area].screen);
  const tabs = props.registry.endTabs(area, screen);
  const place = toastPlace(layout, open, wellWidthOf(tabs.find((x) => x.id === tabId) ?? tabs[0]));
  // 자리는 오른쪽 아래, 상태 표시줄과 입력창 위다(bottom-40). 대화 머리와 첫 줄을 가리지 않는다. 오류 토스트는 caustic이 닫지 않으므로 닫기 단추와 닫힘 시간은 notices.tsx가 정한다
  return (
    <Toaster
      label={t("desktop.shell.toast.label")}
      className="bottom-40 transition-[inset] duration-quick"
      style={
        place.kind === "center-bottom"
          ? { insetInline: "0.5rem" }
          : { insetInlineEnd: `${String(place.endPx)}px` }
      }
    />
  );
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
  const onChatScreen = useShell((s) => s.area === "chat" && s.places.chat.screen === "chat");
  const railArea = useShell((s) => s.area);
  const railScreen = useShell((s) => s.places[s.area].screen);
  // 오른쪽 막대가 있으면 그 폭만큼 무대 오른쪽을 비운다. 막대가 머리줄의 단추를 가리지 않게 한다
  const hasRail = props.registry.endTabs(railArea, railScreen).length > 0;
  useWindowResize();
  useShellShortcuts(props);
  const compact = layout === "compact";
  const navigate = (screen: string): void => {
    props.onSettingsOpenChange(false);
    actions.updatePlace({ screen, scroll: 0 });
    if (compact) actions.setStartOpen(false);
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-app">
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
      <div className="relative flex min-h-0 flex-1">
        {compact && !startOpen ? null : (
          <div
            className={
              compact
                ? "absolute inset-y-0 start-0 z-30 flex w-[min(20rem,calc(100%-3rem))] animate-enter-panel enter-from-start"
                : "flex"
            }
          >
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
              onGoToThread={props.onGoToThread}
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 패널이 닫혔을 때 다시 여는 단추. 대화 화면은 머리줄(chat-header)이 자기 단추를 가진다 */}
          {startOpen || (onChatScreen && !props.settingsOpen) ? null : (
            <div className="flex h-9 flex-none items-end px-3 pt-1.5">
              <IconButton
                size="sm"
                variant="ghost"
                label={t("desktop.shell.start.expand")}
                aria-expanded={false}
                className="-ms-1.5"
                onClick={() => {
                  actions.setStartOpen(true);
                }}
              >
                <PanelLeft />
              </IconButton>
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 p-1.5 pb-0">
            <main
              id={STAGE_ID}
              tabIndex={-1}
              aria-label={t("desktop.shell.stage.label")}
              className={`flex min-w-0 flex-1 flex-col outline-none ${hasRail ? "pe-10" : ""}`}
            >
              <Stage
                registry={props.registry}
                settingsOpen={props.settingsOpen}
                settingsScreen={props.settingsScreen}
              />
            </main>
            <EndPanel registry={props.registry} />
          </div>
          {props.statusBar}
        </div>
      </div>
      <ShellToaster registry={props.registry} />
      {props.palette}
    </div>
  );
}
