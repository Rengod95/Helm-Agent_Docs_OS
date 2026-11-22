// 테스트 챗 창(C7, `review.m6-craft-flows` 6.14, `L4.desktop-ux.spec` §6.27.2). Craft 어디서나 떠 있는 AI 대화다.
// 머리(끌기 손잡이): 상태 구슬, "테스트 챗", 묶인 플러그인 이름, 쓰기 범위 안내(정보 아이콘), 접기, 닫기.
// 본문은 대화 화면의 부품을 그대로 쓴다: 대화 기록(`Transcript`), 폴더 신뢰 카드, 승인 카드(`ApprovalQueue`), 입력창(`Composer`).
// 그 부품들은 고른 대화 하나를 그리므로 창이 보이는 동안 이 대화를 빌린다(`test-chat-layer.tsx`).
// 입력창 위 쌓임의 맨 아래에 이 대화가 만든 드래프트 한 줄과 리뷰로 가는 단추가 선다.
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import {
  Button,
  Card,
  CardPanel,
  Chip,
  IconButton,
  Menu,
  MenuGroup,
  MenuHeading,
  MenuItem,
  Skeleton,
} from "@caustic/react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileCode,
  FlaskConical,
  MessageSquare,
  X,
} from "@caustic/react/icons";
import { BUILD_CHECKS } from "../../../app/build.ts";
import {
  useAllThreadSummaries,
  useOpenThreadId,
  useThread,
  useThreadApprovals,
  useThreadRunning,
} from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useWorkbench } from "../../../state/workbench/index.ts";
import { ApprovalQueue } from "../../approvals.tsx";
import { useCommands } from "../../commands.ts";
import { Composer } from "../../composer.tsx";
import { ComposerBeam } from "../../effects/convo-beam.tsx";
import { ProgressOrb } from "../../effects/progress-orb.tsx";
import { Transcript } from "../../transcript.tsx";
import { TrustCard } from "../../trust.tsx";
import { InfoTip } from "../info-tip.tsx";
import { requestReviewItem } from "../review/review-pick.ts";
import {
  SHAPE_TEXT,
  TEST_CHAT_SHAPES,
  clampOffset,
  collapsedEdgeOf,
  contextChipsOf,
  draftLabelOf,
  type DraftRow,
  type TestChatShape,
} from "./window-model.ts";
import { dispatchTestChat, type TestChatWindow } from "./window-state.ts";
import { useTestChatDraft, type DraftRead } from "./use-test-chat.ts";
import { DEV_DRAFT_SCENES, devDraftRowOf, type DevDraftScene } from "./window-dev.ts";
import { cssPxOf, cssZoomOf } from "../../../lib/zoom.ts";

/** 꼴마다 펼친 창의 자리와 크기(세로 단추 띠의 `aside` 안에서 띠 왼쪽 12px에 끝을 맞춘다. 셸의 well과 같은 기준). 위아래 여백도 12px(`-3`)이다 */
const OPEN_CLASS: Readonly<Record<TestChatShape, string>> = {
  dock: "bottom-3 h-160 max-h-[calc(100%-1.5rem)] w-110",
  column: "top-3 bottom-3 w-110",
  strip: "bottom-3 h-120 max-h-[calc(100%-1.5rem)] w-180",
};

/** 접힌 창(머리 한 줄)의 자리와 폭 */
const COLLAPSED_CLASS: Readonly<Record<"top" | "bottom", string>> = {
  top: "top-3 w-110",
  bottom: "bottom-3 w-110",
};

function useRailBox(): () => DOMRect | null {
  return () => document.querySelector("[data-end-bar]")?.getBoundingClientRect() ?? null;
}

/**
 * 머리를 끌어 창을 옮긴다. 화면 px로 재고 CSS px(앱 배율로 나눈 값)로 옮긴다. 무대 밖과 세로 단추 띠의 칸에는 들어가지 않는다(`clampOffset`)
 */
function useDrag(
  frame: RefObject<HTMLDivElement | null>,
  state: TestChatWindow,
): (event: ReactPointerEvent<HTMLDivElement>) => void {
  const rail = useRailBox();
  return (event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, [role=menu]") !== null) {
      return;
    }
    const box = frame.current;
    if (box === null) return;
    // 창의 부모는 세로 단추 띠의 `aside`(머리 줄 아래부터 바닥까지)이고, 그 부모가 무대 자리(내비 오른쪽부터 창 끝까지)다
    const aside = box.parentElement;
    const stage = aside?.parentElement;
    if (aside === null || stage === null || stage === undefined) return;
    const zoom = cssZoomOf(box);
    const start = { x: event.clientX, y: event.clientY };
    const origin = state.offset;
    const rect = box.getBoundingClientRect();
    // 오프셋 0의 상자(화면 px)
    const base = {
      left: rect.left - origin.x * zoom,
      right: rect.right - origin.x * zoom,
      top: rect.top - origin.y * zoom,
      bottom: rect.bottom - origin.y * zoom,
    };
    const asideRect = aside.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const areaRect = {
      left: stageRect.left,
      right: stageRect.right,
      top: asideRect.top,
      bottom: asideRect.bottom,
    };
    const railRect = rail();
    const head = event.currentTarget;
    head.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent): void => {
      const wanted = {
        x: origin.x * zoom + (e.clientX - start.x),
        y: origin.y * zoom + (e.clientY - start.y),
      };
      const clamped = clampOffset(base, wanted, areaRect, railRect);
      dispatchTestChat({
        type: "move",
        offset: { x: cssPxOf(clamped.x, zoom), y: cssPxOf(clamped.y, zoom) },
      });
    };
    const up = (): void => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
  };
}

/** 머리 왼쪽 표시: 도는 중이면 진행 구슬, 아니면 창의 아이콘 */
function HeadMark(props: { readonly threadId: ThreadId | null }): ReactNode {
  return props.threadId === null ? <WindowIcon /> : <RunMark threadId={props.threadId} />;
}

function WindowIcon(): ReactNode {
  return (
    <span className="grid size-icon-md flex-none place-items-center text-text-tertiary [&_svg]:size-icon-md">
      <MessageSquare aria-hidden />
    </span>
  );
}

function RunMark(props: { readonly threadId: ThreadId }): ReactNode {
  const running = useThreadRunning(props.threadId);
  if (!running) return <WindowIcon />;
  return (
    <span
      role="img"
      aria-label={t("desktop.craft.testChat.running")}
      className="grid size-icon-md flex-none place-items-center"
    >
      <ProgressOrb />
    </span>
  );
}

/** 접힌 창의 "승인 대기 n". 접혀도 답을 기다리는 승인은 보이게 둔다(상태 막대의 칸과 같은 글자와 굵기, DP-189) */
function PendingNote(props: { readonly threadId: ThreadId }): ReactNode {
  const count = useThreadApprovals(props.threadId);
  if (count === 0) return null;
  return (
    <span data-test-chat-pending="" className="flex-none text-ui-sm fx-attend-count">
      {t("desktop.status.approvalsWaiting", { count })}
    </span>
  );
}

function pluginLabelOf(plugin: string | null, displayName: string | undefined): string {
  if (plugin === null) return t("desktop.craft.testChat.newPlugin");
  return displayName ?? plugin;
}

function DevMenu(props: {
  readonly shape: TestChatShape;
  readonly scene: DevDraftScene;
  readonly onScene: (scene: DevDraftScene) => void;
}): ReactNode {
  return (
    <Menu
      align="end"
      size="sm"
      trigger={
        <IconButton
          size="xs"
          variant="ghost"
          label={t("desktop.craft.testChat.dev.menu")}
          data-test-chat-switcher=""
        >
          <FlaskConical aria-hidden />
        </IconButton>
      }
    >
      <MenuGroup>
        <MenuHeading>{t("desktop.craft.testChat.dev.shape")}</MenuHeading>
        {TEST_CHAT_SHAPES.map((shape) => (
          <MenuItem
            key={shape}
            role="menuitemradio"
            selected={shape === props.shape}
            icon={shape === props.shape ? <Check /> : <span className="size-4" />}
            onSelect={() => {
              dispatchTestChat({ type: "shape", shape });
            }}
          >
            {t(SHAPE_TEXT[shape])}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuGroup>
        <MenuHeading>{t("desktop.craft.testChat.dev.draft")}</MenuHeading>
        {DEV_DRAFT_SCENES.map((scene) => (
          <MenuItem
            key={scene.id}
            role="menuitemradio"
            selected={scene.id === props.scene}
            icon={scene.id === props.scene ? <Check /> : <span className="size-4" />}
            onSelect={() => {
              props.onScene(scene.id);
            }}
          >
            {t(scene.label)}
          </MenuItem>
        ))}
      </MenuGroup>
    </Menu>
  );
}

function Head(props: {
  readonly state: TestChatWindow;
  readonly onDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly dev: ReactNode;
}): ReactNode {
  const { state } = props;
  const entries = useWorkbench((s) => s.entries);
  const phase = state.phase;
  const threadId = phase.kind === "ready" ? phase.threadId : null;
  const bound = useAllThreadSummaries().find((thread) => thread.threadId === threadId)?.craftChat
    ?.plugin;
  const phasePlugin = phase.kind === "closed" ? null : phase.plugin;
  // 새 플러그인 대화는 빌더가 플러그인을 만들면 엔진이 그 플러그인에 묶는다(`thread.updated.craftChat`)
  const plugin = bound ?? phasePlugin;
  const display = entries.find((entry) => entry.name === plugin)?.displayName;
  return (
    <div
      data-test-chat-head=""
      onPointerDown={props.onDrag}
      className="flex h-10 flex-none cursor-grab touch-none items-center gap-2 ps-3 pe-2 select-none active:cursor-grabbing"
    >
      <HeadMark threadId={threadId} />
      <h2 className="m-0 flex min-w-0 flex-1 items-baseline gap-2">
        <span className="flex-none text-ui font-semibold text-text-primary">
          {t("desktop.craft.testChat.title")}
        </span>
        <span data-test-chat-plugin="" className="min-w-0 truncate text-ui-sm text-text-tertiary">
          {pluginLabelOf(plugin, display)}
        </span>
      </h2>
      {state.collapsed && threadId !== null ? <PendingNote threadId={threadId} /> : null}
      <InfoTip
        text={t(
          plugin === null
            ? "desktop.craft.testChat.scope.new"
            : "desktop.craft.testChat.scope.plugin",
        )}
      />
      {props.dev}
      <IconButton
        size="xs"
        variant="ghost"
        label={t(
          state.collapsed ? "desktop.craft.testChat.expand" : "desktop.craft.testChat.collapse",
        )}
        onClick={() => {
          dispatchTestChat({ type: "collapse", collapsed: !state.collapsed });
        }}
      >
        {state.collapsed === (collapsedEdgeOf(state.shape) === "bottom") ? (
          <ChevronUp aria-hidden />
        ) : (
          <ChevronDown aria-hidden />
        )}
      </IconButton>
      <IconButton
        size="xs"
        variant="ghost"
        label={t("desktop.craft.testChat.close")}
        onClick={() => {
          dispatchTestChat({ type: "close" });
        }}
      >
        <X aria-hidden />
      </IconButton>
    </div>
  );
}

/** 맥락 칩: 이번에 들고 온 참조(인사이트, 턴, 호출 …). 플러그인 참조는 머리 이름과 같아 칩이 없다 */
function ContextChips(props: { readonly state: TestChatWindow }): ReactNode {
  const chips = contextChipsOf(props.state.contexts);
  if (chips.length === 0) return null;
  return (
    <div
      data-test-chat-context=""
      className="flex flex-none flex-wrap items-center gap-1.5 px-3 pt-3"
      aria-label={t("desktop.craft.testChat.context.label")}
    >
      {chips.map((chip) => (
        <Chip key={chip.key} size="xs" variant="outline">
          {t(chip.label)}
        </Chip>
      ))}
    </div>
  );
}

/**
 * 드래프트 줄(받은 요청 카드와 같은 판: rounded-xl, 1px 안쪽 선, 타일 28, 제목 13/500). 리뷰 전이면 "리뷰로 보내기",
 * 보냈으면 "리뷰에서 보기". 누르면 리뷰 화면이 그 항목을 고른 채 열린다
 */
function DraftCard(props: { readonly row: DraftRow; readonly onSent: () => void }): ReactNode {
  const { row } = props;
  const commands = useCommands();
  const shell = useShellActions();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (row.kind === "none") return null;
  const openReview = (itemId: string): void => {
    requestReviewItem(itemId);
    shell.updatePlace({ screen: "craftReview", scroll: 0 });
  };
  const send = (draftId: string): void => {
    setBusy(true);
    setFailed(false);
    detach(
      commands.testChat.submitDraft(draftId).then((sent) => {
        setBusy(false);
        if (!sent.ok) {
          setFailed(true);
          return undefined;
        }
        props.onSent();
        openReview(sent.value.itemId);
        return undefined;
      }),
      rethrow,
    );
  };
  return (
    <div
      data-test-chat-draft={row.kind}
      className="flex items-center gap-3 rounded-xl bg-surface-base px-4 py-3 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-neutral-well text-text-secondary [&_svg]:size-4">
        <FileCode aria-hidden />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-ui font-medium text-text-primary">
          {t("desktop.craft.testChat.draft.title", { name: draftLabelOf(row.draft) })}
        </span>
        <span className="truncate text-ui-sm text-text-tertiary">
          {failed
            ? t("desktop.craft.testChat.draft.sendFailed")
            : t(
                row.kind === "draft"
                  ? "desktop.craft.testChat.draft.notSent"
                  : "desktop.craft.testChat.draft.inReview",
              )}
        </span>
      </div>
      {row.kind === "draft" ? (
        <Button
          size="sm"
          variant="solid"
          loading={busy}
          onClick={() => {
            send(row.draft.draftId);
          }}
        >
          {t("desktop.craft.testChat.draft.send")}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            openReview(row.itemId);
          }}
        >
          {t("desktop.craft.testChat.draft.open")}
        </Button>
      )}
    </div>
  );
}

function rowOfRead(read: DraftRead): DraftRow {
  return read.kind === "ready" ? read.row : { kind: "none" };
}

/** 보낸 것이 없는 테스트 챗의 한 줄 안내. 대화 화면의 새 대화 화면(폴더 고르기)은 테스트 챗에 맞지 않아 그리지 않는다 */
function EmptyHint(props: {
  readonly threadId: ThreadId;
  readonly plugin: string | null;
}): ReactNode {
  const summary = useThread(props.threadId);
  const running = useThreadRunning(props.threadId);
  if (summary === undefined || summary.lastTurnId !== undefined || running) return null;
  return (
    <p className="pointer-events-none absolute inset-x-0 top-1/3 m-0 px-6 text-center text-ui text-text-tertiary">
      {t(
        props.plugin === null
          ? "desktop.craft.testChat.empty.new"
          : "desktop.craft.testChat.empty.plugin",
      )}
    </p>
  );
}

function Body(props: { readonly state: TestChatWindow; readonly scene: DevDraftScene }): ReactNode {
  const { phase } = props.state;
  switch (phase.kind) {
    case "closed":
      return null;
    case "opening":
      return (
        <div role="status" aria-busy="true" className="grid content-start gap-2 p-3">
          <span className="sr-only">{t("desktop.craft.testChat.opening")}</span>
          <Skeleton height={32} />
          <Skeleton height={32} />
        </div>
      );
    case "failed":
      return (
        <div role="alert" className="grid content-start gap-2 p-3 text-ui text-text-secondary">
          {t(
            phase.error.kind === "unsupported"
              ? "desktop.craft.testChat.openUnsupported"
              : "desktop.craft.testChat.openFailed",
          )}
        </div>
      );
    case "ready":
      return <ReadyBody state={props.state} threadId={phase.threadId} scene={props.scene} />;
    default:
      return assertNever(phase, "TestChatPhase");
  }
}

function ReadyBody(props: {
  readonly state: TestChatWindow;
  readonly threadId: ThreadId;
  readonly scene: DevDraftScene;
}): ReactNode {
  const open = useOpenThreadId();
  const bound = useThread(props.threadId)?.craftChat?.plugin;
  const phasePlugin = props.state.phase.kind === "ready" ? props.state.phase.plugin : null;
  const plugin = bound ?? phasePlugin;
  const draft = useTestChatDraft(props.threadId, plugin);
  const row = devDraftRowOf(props.scene, props.threadId) ?? rowOfRead(draft.read);
  // 빌린 대화가 아직 열리지 않았으면(고르기 직후) 다른 대화의 기록이 비치지 않게 뼈대를 둔다
  const mine = open === props.threadId;
  return (
    <>
      <ContextChips state={props.state} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {mine ? <Transcript /> : null}
        {mine ? <EmptyHint threadId={props.threadId} plugin={plugin} /> : null}
      </div>
      <div
        data-test-chat-stack=""
        className="flex min-h-0 flex-col gap-2 px-3 pb-2 empty:hidden [&>*]:shrink-0 [&>:has(>[data-approval-band])]:shrink"
      >
        {mine ? <TrustCard /> : null}
        {mine ? <ApprovalQueue /> : null}
        <DraftCard row={row} onSent={draft.reload} />
      </div>
      {mine ? (
        <ComposerBeam>
          <Composer />
        </ComposerBeam>
      ) : null}
    </>
  );
}

export function TestChatWindowView(props: { readonly state: TestChatWindow }): ReactNode {
  const { state } = props;
  const frame = useRef<HTMLDivElement>(null);
  const onDrag = useDrag(frame, state);
  const [scene, setScene] = useState<DevDraftScene>("live");
  const edge = collapsedEdgeOf(state.shape);
  // 창 크기가 바뀌어 옮긴 창이 무대 밖으로 나가면 처음 자리로 돌린다
  useEffect(() => {
    const onResize = (): void => {
      dispatchTestChat({ type: "move", offset: { x: 0, y: 0 } });
    };
    globalThis.addEventListener("resize", onResize);
    return () => {
      globalThis.removeEventListener("resize", onResize);
    };
  }, []);
  const place = state.collapsed ? COLLAPSED_CLASS[edge] : OPEN_CLASS[state.shape];
  return (
    <div
      ref={frame}
      data-test-chat={state.shape}
      data-collapsed={state.collapsed ? "" : undefined}
      role="dialog"
      aria-modal="false"
      aria-label={t("desktop.craft.testChat.title")}
      className={`pointer-events-auto absolute end-[calc(100%+0.75rem)] z-10 flex max-w-[calc(var(--app-vw)-6rem)] ${place}`}
      style={{ transform: `translate(${state.offset.x}px, ${state.offset.y}px)` }}
    >
      <Card variant="well" size="sm" className="flex min-h-0 w-full flex-col shadow-3">
        <Head
          state={state}
          onDrag={onDrag}
          dev={
            BUILD_CHECKS ? <DevMenu shape={state.shape} scene={scene} onScene={setScene} /> : null
          }
        />
        {state.collapsed ? null : (
          <CardPanel className="flex min-h-0 flex-1 flex-col gap-0 p-0">
            <Body state={state} scene={scene} />
          </CardPanel>
        )}
      </Card>
    </div>
  );
}
