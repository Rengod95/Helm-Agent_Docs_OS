import { ThreadsArt } from "./illustrations/index.tsx";
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  Skeleton,
} from "@caustic/react";
import { Folder, FolderOpen, RotateCcw, Search, X } from "@caustic/react/icons";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useFlipList } from "../lib/motion-presets.tsx";
import { ProgressOrb } from "./effects/progress-orb.tsx";
import {
  useApprovalUrgent,
  useThreadsStatus,
  useThreadSummaries,
  useThreadApprovals,
  useTurnFailure,
  useUnlistedApprovals,
} from "../state/engine/index.ts";
import { useShellActions } from "../state/shell/index.ts";
import { useScreen, useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { SIDE_ROW } from "./side-row.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "./folder-pick.ts";
import { useStartNewThread } from "./new-thread-flow.ts";
import { recentWorkspacesOf, type RecentWorkspace } from "./new-thread-model.ts";
import { folderLabel, folderPartsOf, sidebarGroupsOf } from "./thread-groups.ts";
import {
  relativeTimeOf,
  rowBadgeOf,
  rowLabelOf,
  rowOpensChat,
  threadMatches,
  type RelativeTime,
} from "./thread-nav-model.ts";
import { ThreadRowMenu } from "./thread-row-menu.tsx";
import { unsentRowOf } from "./turn-failure-model.ts";
import { checkWorkspaceInput, createFailureText, workspaceHint } from "./workspace-model.ts";

/** 대화 상자가 닫히며 초점을 되돌리는 시간(ms)보다 넉넉히 */
const DIALOG_CLOSE_MS = 300;

/**
 * 하위 대화 행은 부모보다 한 칸 들여 쓴다. caustic 행은 `w-full`이라 왼쪽 여백만 더하면 그만큼 오른쪽으로 넘쳐 끝 배지("하위")가
 * 잘린다. 폭을 `w-auto`로 풀고 여백을 뺀 폭 안에 가둬 제목이 줄고 배지는 그대로 보이게 한다
 */
export const CHILD_ROW = "ms-4 w-auto max-w-[calc(100%-1rem)]";

/** 제목 없는 줄(첫 입력 미리보기 포함): 기울임 없이 글자색만 tertiary(DP-104, DP-141) */
const UNTITLED_LABEL = "[&_[data-slot=list-navigation-label]]:text-text-tertiary";

/**
 * 긴 제목이 열을 넓히지 않게 목록·그룹·행의 격자 열을 minmax(0,1fr)로 묶는다(말줄임은 caustic 라벨의 truncate가 한다).
 * 폴더 머리 끝 여백은 대화 줄 안쪽 여백(8px)과 같게 둔다: "+" 글리프 끝이 줄 꼬리 글(만든 때)·⋯ 글리프 끝과 한 세로선(줄 끝 − 8)에 선다(DP-138)
 */
const LIST_COLUMN =
  "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 [&_ul]:grid-cols-[minmax(0,1fr)] [&_[data-slot=list-navigation-item]]:min-w-0 [&_[data-slot=list-navigation-item]]:grid-cols-[minmax(0,1fr)] [&_[data-slot=list-navigation-heading]]:text-ui [&_[data-slot=list-navigation-heading]]:normal-case [&_[data-slot=list-navigation-heading]]:pe-2";

/**
 * 대화 행은 위 탐색 줄과 같은 크기(`SIDE_ROW`: 높이 h-control-md, 글자 ui-md)다. 행 뒤 ⋯ 칸도 같은 높이를 쓴다 [결정: 2026-11-08 사용자, dsB·dsM]
 */
const ROW_HEIGHT = SIDE_ROW;

/**
 * 행 오른쪽 표식(DP-104). 승인은 둥근 면 위의 무채색 숫자(DP-189: 줄에는 크리스탈 표시가 없고 수와 그 면이 주의를 맡는다. DP-150: 제목 칸을 먼저 자르지 않게 좁게), 나머지는 12px tertiary 글과 필요한 곳만 아이콘 12. 종류는 `rowBadgeOf`가 정한다 */
function metaOf(
  thread: ThreadSummary,
  approvals: number,
  child: boolean,
  unsent: boolean,
  now: number,
  urgent: boolean,
): ReactNode {
  const badge = rowBadgeOf(thread, approvals, child, unsent);
  switch (badge) {
    case "approvals":
      return <ApprovalCount approvals={approvals} urgent={urgent} />;
    // 이어서 실행은 아이콘과 글(시안 threadMeta의 RotateCcw + 이어서 실행)
    case "resumable":
      return (
        <span className="inline-flex items-center gap-1" data-thread-badge="resumable">
          <RotateCcw aria-hidden className="size-3" />
          {t("desktop.threads.resumableBadge")}
        </span>
      );
    case "unsent":
      return <span className="text-danger-text">{t("desktop.threads.unsentBadge")}</span>;
    case "schedule":
      return t("desktop.threads.scheduleBadge");
    case "remote":
      return t("desktop.threads.remoteBadge");
    case "closed":
      return t("desktop.threads.closedBadge");
    case "sub":
      return t("desktop.threads.subBadge");
    case "forked":
      return t("desktop.threads.forkedBadge");
    case null:
      // 제목 없는 대화는 서로 구분되도록 언제 만들었는지를 꼬리에 둔다
      return rowLabelOf(thread).dim
        ? relativeTimeText(relativeTimeOf(thread.createdAt, now))
        : undefined;
    default:
      return assertNever(badge, "rowBadgeOf");
  }
}

function relativeTimeText(time: RelativeTime): string {
  switch (time.unit) {
    case "now":
      return t("desktop.threads.time.now");
    case "minutes":
      return t("desktop.threads.time.minutes", { count: time.count });
    case "hours":
      return t("desktop.threads.time.hours", { count: time.count });
    case "days":
      return t("desktop.threads.time.days", { count: time.count });
    case "date":
      return t("desktop.threads.time.date", { month: time.month, day: time.day });
    default:
      return assertNever(time, "RelativeTime");
  }
}

/** 줄 끝 수의 글: 100 이상은 "99+" */
function approvalCountText(approvals: number): string {
  return approvals > 99 ? "99+" : String(approvals);
}

/**
 * 줄 끝 승인 수(DP-189 [결정: 2026-11-18 사용자 "일반 대화 row 우측에는 아이콘 없어야 할듯함. 그리고 추가적으로 숫자의 백그라운드에 동그란 surface를 넣어줘.
 * 패딩은 너무 크지않게 적당히", lcMk3]가 2026-11-13 "원형 뒷배경 빼는게"를 바꿈). caustic 배지(neutral soft, xs 18px, 좌우 6px)의 둥근 면에
 * 무채색 숫자, 면에 아주 옅은 오로라 기운이 든다(`.fx-attend-pill`). 급함(시한 있는 승인)은 빛깔이 아니라 밝기로 다르다: 숫자가 한 단계 진하고 면이 밝으며
 * 오로라 테 1px이 둘린다. 보이는 숫자는 낭독하지 않고 숨은 글이 "승인 n개를 기다려요(· 시한이 있어요)"를 말한다
 */
function ApprovalCount(props: { readonly approvals: number; readonly urgent: boolean }): ReactNode {
  const waiting = t("desktop.threads.approvalsWaiting", { count: props.approvals });
  return (
    <Badge
      size="xs"
      className="fx-attend-pill"
      data-thread-badge="approvals"
      data-urgent={props.urgent ? "" : undefined}
    >
      <span aria-hidden>{approvalCountText(props.approvals)}</span>
      <span className="sr-only">
        {props.urgent ? t("desktop.attention.deadline", { what: waiting }) : waiting}
      </span>
    </Badge>
  );
}

const ThreadRow = memo(function ThreadRow(props: {
  readonly thread: ThreadSummary;
  /** 하위 에이전트가 만든 자식 대화: 부모 아래 들여 쓴 행 */
  readonly child: boolean;
  /** 지금 시각(ms). 제목 없는 줄의 상대 시각에 쓴다. 목록이 1분마다 올린다 */
  readonly now: number;
}): ReactNode {
  const commands = useCommands();
  const shell = useShellActions();
  const screen = useScreen();
  const id: ThreadId = props.thread.threadId;
  const selected = useSelectedThreadId() === id;
  const unlisted = useUnlistedApprovals(id);
  const approvals = useThreadApprovals(id);
  const unsent = unsentRowOf(useTurnFailure(id));
  const attention = approvals > 0 || unlisted > 0;
  const urgent = useApprovalUrgent(id);
  const running = props.thread.status === "running";
  const [menuOpen, setMenuOpen] = useState(false);
  // 제목이 없는 대화는 첫 입력 미리보기를 제목 자리에 흐리게 두고(DP-141), 미리보기도 없으면 "제목 없음"을 흐리게 둔다. 꼬리에 만든 때를 붙여 서로 구분한다(DP-104)
  const label = rowLabelOf(props.thread);
  const title = label.text ?? t("desktop.threads.untitled");
  // 툴팁에는 제목 아래로 알릴 말을 한 줄씩 더한다. 표시가 없으면 제목만 남는다
  const tooltip = [
    title,
    approvals > 0 ? t("desktop.threads.approvalsWaiting", { count: approvals }) : null,
    unlisted > 0 ? t("desktop.threads.unlistedApprovals") : null,
    unsent ? t("desktop.threads.status.unsent") : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return (
    <>
      <ListNavigationItem
        current={selected}
        // 앞 칸(DP-189 [결정: 2026-11-13 사용자 "좌측 아이콘은 아예 빼버리고"]): 줄 앞에는 표시를 두지 않아 모든 줄의 제목이 같은 열에 선다.
        // 내 확인이 필요하면 끝의 둥근 면 위 숫자(줄 물듦은 lcMk3가 뺐다), 도는 중이면 끝의 진행 구슬, 안 보냈으면 caustic 실패 점이다. caustic
        // `status="running"`은 스펙트럼 고리를 그려 쓰지 않는다(DP-188). 승인을 기다리는 턴은 멈춰 있으므로 주의가 이긴다(진행 구슬 없음)
        {...(!attention && !running && unsent
          ? {
              status: "failed" as const,
              statusLabels: { failed: t("desktop.threads.status.unsent") },
            }
          : {})}
        // 줄 끝 한 칸: 꼬리 글이나 승인 수(둥근 면) · 진행 구슬(도는 중). 줄에는 크리스탈 표시를 두지 않는다(DP-189, lcMk3). 꼬리 글과 진행 구슬 사이 6
        meta={
          <span data-slot="row-meta" className="inline-flex items-center gap-1">
            {metaOf(props.thread, approvals, props.child, unsent, props.now, urgent)}
            {running && !attention ? <ProgressOrb className="ms-0.5" /> : null}
          </span>
        }
        // 목록 순서가 바뀌거나 행이 들고 날 때 옛 자리에서 이어 온다(ThreadList의 useFlipList)
        data-flip-key={id}
        title={tooltip}
        // 오른쪽 클릭은 ⋯와 같은 메뉴를 연다(줄 끝 ⋯ 자리에 붙는다)
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen(true);
        }}
        className={[ROW_HEIGHT, label.dim ? UNTITLED_LABEL : "", props.child ? CHILD_ROW : ""]
          .filter((c) => c !== "")
          .join(" ")}
        onSelect={() => {
          // 설정이나 받은 요청 같은 전체 쪽이 열려 있으면 그 대화 화면으로 간다(rtE R-5)
          const model = shell.snapshot();
          if (
            rowOpensChat({
              screen,
              area: model.area,
              chatPlaceScreen: model.places.chat.screen,
            })
          ) {
            if (model.area !== "chat") shell.switchArea("chat");
            commands.showScreen("chat");
            if (model.places.chat.screen !== "chat")
              shell.updatePlace({ screen: "chat", scroll: 0 });
          }
          commands.selectThread(id);
        }}
      >
        {running && !attention ? (
          <span className="sr-only">{`${t("desktop.threads.status.running")}: `}</span>
        ) : null}
        {title}
      </ListNavigationItem>
      {/* 행 뒤 높이 0인 칸에 ⋯를 겹친다(caustic 행에 동작 자리가 없다). 보임과 승인 수 비움은 styles.css [data-row-menu] */}
      {/* 고른 줄은 ⋯를 늘 보인다(`data-row-menu="current"`, styles.css) */}
      {/* DP-138: 대화 줄 사이 격자 간격(1px)만큼 더 올려 ⋯ 칸이 줄과 같은 y에 선다(전에는 1px 아래). 끝 3px: 24px 칸 안 14px 글리프의 끝이
          줄 끝 − 8(줄 꼬리 글과 폴더 머리 "+"의 끝)에 온다 */}
      <li
        data-row-menu={selected ? "current" : ""}
        className="pointer-events-none relative -mt-[calc(var(--spacing-control-md)+1px)] flex h-control-md list-none items-center justify-end pe-0.75"
      >
        <ThreadRowMenu
          id={id}
          title={props.thread.title ?? t("desktop.threads.untitled")}
          status={props.thread.status}
          bare
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      </li>
    </>
  );
});

/** 다른 폴더(경로를 적거나 고른 폴더)에서 새 대화를 여는 대화 상자(시안 O-07). 만들면 닫힌다 */
function OtherFolder(props: {
  readonly folderPick: FolderPickInvoke | undefined;
  readonly creating: boolean;
  readonly recent: readonly RecentWorkspace[];
  readonly onCreate: (path: string | null) => void;
  readonly onPickFailed: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pickFailed, setPickFailed] = useState(false);
  const workspace = checkWorkspaceInput(text);
  const hint = workspaceHint(workspace);
  const folderPick = props.folderPick;
  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const picked = await pickWorkspaceFolder(invoke);
    if (!picked.ok) {
      setPickFailed(true);
      props.onPickFailed();
      return;
    }
    if (picked.value !== undefined) setText(picked.value);
  };
  // 대화 상자를 닫고 만든다. 만들지 못한 까닭은 목록 아래 줄에 보인다
  const create = (): void => {
    if (props.creating || workspace.kind === "invalid") return;
    setOpen(false);
    props.onCreate(workspace.kind === "path" ? workspace.path : null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title={t("desktop.threads.newDialog.title")}
      trigger={
        <Button size="xs" variant="ghost" className="justify-self-start">
          {t("desktop.threads.otherFolder")}
        </Button>
      }
      footer={
        <>
          <span aria-hidden className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t("desktop.threads.newDialog.cancel")}
          </Button>
          <Button
            size="sm"
            variant="solid"
            loading={props.creating}
            disabled={props.creating || hint !== null}
            onClick={create}
          >
            {text.trim() === ""
              ? t("desktop.threads.newDialog.createNoFolder")
              : t("desktop.threads.newDialog.create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {pickFailed ? (
          <Alert tone="danger" layout="inline" size="sm">
            {t("desktop.workspace.pickFailed")}
          </Alert>
        ) : null}
        <Field
          label={t("desktop.threads.newDialog.folderLabel")}
          optional
          optionalLabel={t("desktop.threads.newDialog.optional")}
          error={hint ?? undefined}
          size="sm"
        >
          <Input
            size="sm"
            value={text}
            invalid={hint !== null}
            spellCheck={false}
            autoComplete="off"
            placeholder="/Users/me/project"
            className="font-mono text-mono-sm"
            onValueChange={(value) => {
              setText(value);
              setPickFailed(false);
            }}
            onKeyDown={(event) => {
              // 한글 조합 중의 Enter는 글자를 확정하는 키라 만들기가 아니다
              if (event.key === "Enter" && !event.nativeEvent.isComposing) create();
            }}
            suffix={
              folderPick === undefined ? null : (
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={t("desktop.workspace.pickFolderButton")}
                  disabled={props.creating}
                  onClick={() => detach(pick(folderPick), rethrow)}
                >
                  <FolderOpen />
                </IconButton>
              )
            }
          />
        </Field>
        {props.recent.length === 0 ? null : (
          <ListNavigation aria-label={t("desktop.threads.recentLabel")} size="xs" as="div">
            <ListNavigationGroup heading={t("desktop.threads.recentHeading")}>
              {props.recent.map((recent) => (
                <ListNavigationItem
                  key={recent.path}
                  icon={<Folder />}
                  current={text.trim() === recent.path}
                  meta={t("desktop.threads.recentCount", { count: recent.count })}
                  onSelect={() => {
                    setText(recent.path);
                    setPickFailed(false);
                  }}
                >
                  <span className="font-mono text-mono-sm">{recent.path}</span>
                </ListNavigationItem>
              ))}
            </ListNavigationGroup>
          </ListNavigation>
        )}
      </div>
    </Dialog>
  );
}

/**
 * 폴더 묶음 머리(DP-150): 마지막 폴더 이름(13/500 secondary) + 부모 경로(12 tertiary, 앞을 생략). 올리면 전체 경로.
 * 부모 경로는 rtl 칸에 ltr 글을 두어 말줄임이 앞에 온다(caustic Badge mono와 같은 방법)
 */
function FolderHeading(props: { readonly path: string }): ReactNode {
  const { name, parent } = folderPartsOf(props.path);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5" title={props.path}>
      <span className="max-w-full shrink-0 truncate text-ui font-medium text-text-secondary">
        {name}
      </span>
      {parent === "" ? null : (
        <span dir="rtl" className="min-w-0 truncate text-footnote text-text-tertiary">
          <bdi dir="ltr">{parent}</bdi>
        </span>
      )}
    </span>
  );
}

/** 1분마다 바뀌는 지금 시각(ms). 제목 없는 줄의 "3분 전"을 맞춘다 */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

export function ThreadList(props: {
  /** 폴더 선택 창을 부르는 invoke. 없으면(웹 등) 고르기 단추를 보이지 않는다 */
  readonly folderPick?: FolderPickInvoke | undefined;
}): ReactNode {
  const commands = useCommands();
  const threads = useThreadSummaries();
  const status = useThreadsStatus();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startThread = useStartNewThread(props.folderPick);
  /** `path`: 글은 그 폴더, `undefined`는 보던 폴더(없으면 고르기), `null`은 대화 상자의 "폴더 없이 만들기" */
  const create = async (path: string | null | undefined): Promise<void> => {
    setError(null);
    setCreating(true);
    const result = await startThread(path);
    setCreating(false);
    if (result.kind === "failed")
      setError(createFailureText(result.error, typeof path === "string"));
    else if (result.kind === "pickFailed") setError(t("desktop.workspace.pickFailed"));
  };
  const start = (path: string | null | undefined): void => {
    detach(create(path), rethrow);
  };
  // 새 대화 대화 상자는 닫히면서 초점을 자기 단추로 되돌린다. 닫힌 뒤에 입력창 초점을 한 번 더 요청한다
  const startFromDialog = (path: string | null): void => {
    const run = async (): Promise<void> => {
      await create(path);
      window.setTimeout(() => {
        commands.requestComposer(null);
      }, DIALOG_CLOSE_MS);
    };
    detach(run(), rethrow);
  };

  const [query, setQuery] = useState("");
  const now = useMinuteClock();
  const shown =
    query.trim() === "" ? threads : threads.filter((thread) => threadMatches(thread, query));
  const groups = sidebarGroupsOf(shown);
  const recent = recentWorkspacesOf(threads);
  // 새 대화·지운 대화·순서 바뀜은 FLIP으로 잇는다(dzM2 시안 §11). 찾기 글이 바뀐 커밋은 거르기라 움직이지 않는다
  const list = useRef<HTMLDivElement | null>(null);
  useFlipList(
    list,
    groups.map((group) => group.items.map((row) => row.thread.threadId).join(",")).join("|"),
    query.trim(),
  );
  return (
    <div ref={list} className={LIST_COLUMN}>
      {threads.length === 0 ? null : (
        // DP-136 [결정: 2026-11-12 사용자] 찾기 칸은 내비 줄과 같은 32px(md)이고 줄과 같은 폭(패널 안쪽 여백 6px만 남김)이다
        <div className="pb-1">
          <Input
            size="md"
            // 브라우저 검색칸의 지우기 단추와 겹치지 않게 글칸에 searchbox 역할을 준다(지우기는 아래 suffix 하나)
            type="text"
            role="searchbox"
            data-thread-search=""
            value={query}
            aria-label={t("desktop.threads.search.label")}
            placeholder={t("desktop.threads.search.placeholder")}
            spellCheck={false}
            autoComplete="off"
            prefix={<Search aria-hidden />}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query !== "") {
                event.preventDefault();
                setQuery("");
              }
            }}
            suffix={
              query === "" ? null : (
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={t("desktop.threads.search.clear")}
                  onClick={() => {
                    setQuery("");
                  }}
                >
                  <X aria-hidden />
                </IconButton>
              )
            }
          />
        </div>
      )}
      {query.trim() !== "" && shown.length === 0 ? (
        <p role="status" className="m-0 px-3 py-2 text-ui text-text-tertiary">
          {t("desktop.threads.search.empty", { query: query.trim() })}
        </p>
      ) : null}
      <ListNavigation
        aria-label={t("desktop.threads.listLabel")}
        kind="sessions"
        size="sm"
        as="div"
      >
        {groups.map((group) => (
          <ListNavigationGroup
            key={group.workspace ?? ""}
            heading={
              group.workspace === null ? (
                t("desktop.threads.noFolder")
              ) : (
                <FolderHeading path={group.workspace} />
              )
            }
            addLabel={
              group.workspace === null
                ? t("desktop.threads.newButton")
                : t("desktop.threads.newIn", { folder: folderLabel(group.workspace) })
            }
            onAdd={() => {
              start(group.workspace ?? undefined);
            }}
          >
            {group.items.map((row) => (
              <ThreadRow
                key={row.thread.threadId}
                thread={row.thread}
                child={row.child}
                now={now}
              />
            ))}
          </ListNavigationGroup>
        ))}
      </ListNavigation>
      {status === "loading" && threads.length === 0 ? (
        <div
          role="status"
          aria-label={t("desktop.threads.loading")}
          className="grid gap-1.5 px-2 pt-1"
        >
          {[70, 55, 82, 48, 64].map((w) => (
            <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : null}
      {status === "error" ? (
        <EmptyState
          size="sm"
          surface="none"
          title={t("desktop.threads.loadFailed")}
          actions={
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                commands.reloadThreads();
              }}
            >
              {t("desktop.threads.reloadButton")}
            </Button>
          }
        />
      ) : null}
      {status === "ready" && threads.length === 0 ? (
        <EmptyState
          media={<ThreadsArt />}
          size="sm"
          surface="none"
          title={t("desktop.threads.empty")}
          actions={
            <Button
              size="xs"
              variant="outline"
              disabled={creating}
              onClick={() => {
                start(undefined);
              }}
            >
              {t("desktop.threads.newButton")}
            </Button>
          }
        />
      ) : null}
      <div className="px-1.5">
        <OtherFolder
          folderPick={props.folderPick}
          creating={creating}
          recent={recent}
          onCreate={startFromDialog}
          onPickFailed={() => {
            setError(t("desktop.workspace.pickFailed"));
          }}
        />
      </div>
      {error === null ? null : (
        <div role="alert" className="px-2 text-ui text-danger-text">
          {error}
        </div>
      )}
    </div>
  );
}
