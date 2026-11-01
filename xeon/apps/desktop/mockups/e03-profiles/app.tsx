// N-57 프로필 관리(묶음 E). 자리: 작업대 "구성"의 "프로필" 보기(P-21 §6.28.3). 캔버스(실효 스택 그림)는 이번 범위가 아니라
// 목록 + 상세로 그린다: 왼쪽 프로필 목록(만들기·이름 바꾸기·복제·지우기), 오른쪽 고른 프로필의 내용과 쓰는 곳.
// 저장은 호스트(profile.list·get·put·delete, W-46)라 데스크톱·웹·앱이 같은 목록이다. baseRev 충돌은 상세 위 Alert 하나(DP-28).
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  ListDescription,
  ListDescriptionRow,
  Menu,
  MenuItem,
  MenuSeparator,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  toast,
} from "@caustic/react";
import { useEffect } from "react";
import {
  defaultStatusCells,
  Ellipsis,
  extName,
  L,
  L2,
  Plus,
  ScenarioDock,
  Shell,
  ShellToaster,
  T,
  useShell,
  WB_WIDTH,
  WorkbenchHead,
  workbenchRightTabs,
  type StatusCell,
} from "../_shell";
import { useMachine, usePrefill } from "../_chat-rt";
import { effect, init, reduce, SCRIPTS, USES, type A, type Profile, type S } from "./flow";

interface Look {
  script: string;
  n: number;
  over?: Partial<S>;
}

export const STATES = [
  { id: "main", label: "목록과 상세" },
  { id: "menu", label: "행 메뉴" },
  { id: "create", label: "새 프로필" },
  { id: "rename", label: "이름 바꾸기" },
  { id: "duplicated", label: "복제 뒤" },
  { id: "delete-confirm", label: "지우기 확인(쓰는 곳)" },
  { id: "conflict", label: "다른 곳에서 바뀜(baseRev)" },
  { id: "reloaded", label: "다시 읽은 뒤" },
  { id: "live-changed", label: "profile.changed 갱신" },
  { id: "empty", label: "프로필 없음" },
  { id: "loading", label: "읽는 중" },
  { id: "offline", label: "오프라인" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, Look> = {
  main: { script: "base", n: 0 },
  menu: { script: "menu", n: 1 },
  create: { script: "profile-crud", n: 2 },
  rename: { script: "profile-conflict", n: 2 },
  duplicated: { script: "profile-crud", n: 8 },
  "delete-confirm": { script: "profile-crud", n: 9 },
  conflict: { script: "profile-conflict", n: 4 },
  reloaded: { script: "profile-conflict", n: 5 },
  "live-changed": { script: "profile-live", n: 1 },
  empty: { script: "base", n: 0, over: { list: [], sel: null, load: "empty" } },
  loading: { script: "base", n: 0, over: { load: "loading" } },
  offline: { script: "base", n: 0, over: { load: "offline" } },
};

export const SCENARIOS = [
  { id: "profile-crud", label: "만들기 → 이름 바꾸기 → 복제 → 지우기" },
  { id: "profile-conflict", label: "실패: 이름 저장 중 다른 곳에서 바뀜 → 다시 읽기" },
  { id: "profile-live", label: "다른 기기가 바꿈 → 목록 갱신" },
];

const title = (p: Profile) => L(p.title);

function Marks({ p }: { p: Profile }) {
  return (
    <span className="truncate text-ui-xs text-text-tertiary">
      {[
        p.enable.length > 0 ? `+${p.enable.length}` : null,
        p.disable.length > 0 ? `−${p.disable.length}` : null,
        p.settings.length > 0 ? `~${p.settings.length}` : null,
      ]
        .filter((x) => x !== null)
        .join(" ")}
    </span>
  );
}

function ProfileList({ s, go, offline }: { s: S; go: (a: A) => void; offline: boolean }) {
  if (s.load === "loading")
    return (
      <div
        role="status"
        aria-label={L2("프로필 읽는 중", "Loading profiles")}
        className="grid gap-2 pt-1"
      >
        {[70, 52, 64].map((w) => (
          <Skeleton key={w} className="h-8 rounded-md" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0" aria-label={T.profile}>
      {s.list.map((p) => {
        const on = p.id === s.sel;
        return (
          <li key={p.id} className="group relative">
            <button
              type="button"
              aria-current={on ? "true" : undefined}
              onClick={() => go({ t: "sel", id: p.id })}
              className={`grid w-full min-w-0 gap-0.5 rounded-lg py-1.5 ps-2.5 pe-9 text-left outline-none focus-visible:focus-ring ${
                on ? "bg-surface-raised shadow-1" : "hover:bg-fill-hover"
              }`}
            >
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span
                  className={`truncate text-ui-sm ${on ? "font-semibold" : "font-medium"} text-text-primary`}
                >
                  {title(p)}
                </span>
                <span className="truncate font-mono text-mono-sm text-text-tertiary">{p.id}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <Marks p={p} />
                {s.fresh === p.id ? (
                  <span className="text-ui-xs text-text-secondary">
                    · {L2("방금 바뀜", "just changed")}
                  </span>
                ) : (USES[p.id]?.length ?? 0) > 0 ? (
                  <span className="truncate text-ui-xs text-text-tertiary">
                    · {L2(`쓰는 곳 ${USES[p.id]?.length ?? 0}`, `${USES[p.id]?.length ?? 0} uses`)}
                  </span>
                ) : null}
              </span>
            </button>
            <span className="absolute end-1 top-1.5">
              <Menu
                size="sm"
                align="end"
                open={s.menuFor === p.id ? true : undefined}
                onOpenChange={(o) => go({ t: "menu", id: o ? p.id : null })}
                aria-label={L2(`${title(p)} 메뉴`, `${title(p)} menu`)}
                trigger={
                  <IconButton
                    size="xs"
                    variant="ghost"
                    label={L2(`${title(p)} 메뉴`, `${title(p)} menu`)}
                    className={
                      on || s.menuFor === p.id
                        ? ""
                        : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    }
                  >
                    <Ellipsis />
                  </IconButton>
                }
              >
                <MenuItem disabled={offline} onSelect={() => go({ t: "renameStart", id: p.id })}>
                  {L2("이름 바꾸기", "Rename")}
                </MenuItem>
                <MenuItem disabled={offline} onSelect={() => go({ t: "duplicate", id: p.id })}>
                  {L2("복제", "Duplicate")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  tone="danger"
                  disabled={offline}
                  onSelect={() => go({ t: "deleteAsk", id: p.id })}
                >
                  {L2("지우기…", "Delete…")}
                </MenuItem>
              </Menu>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ s, go, offline }: { s: S; go: (a: A) => void; offline: boolean }) {
  const p = s.list.find((x) => x.id === s.sel);
  if (p === undefined) return null;
  const uses = USES[p.id] ?? [];
  const renaming = s.renaming === p.id;
  const c = s.conflict;
  return (
    <section aria-label={title(p)} className="grid min-w-0 content-start gap-3">
      {c !== null && c.id === p.id && (
        <Alert
          tone="warning"
          size="sm"
          actions={[
            { label: L2("다시 읽기", "Reload"), primary: true, onClick: () => go({ t: "reload" }) },
            {
              label: L2("내 것으로 덮어쓰기", "Overwrite with mine"),
              onClick: () => go({ t: "overwrite" }),
            },
          ]}
        >
          <span className="font-semibold">{T.editedElsewhere}</span>
          {" · "}
          {L2(
            `${c.theirs.by}에서 ${c.theirs.at} 먼저 저장했어요(rev ${p.rev} → ${c.theirs.rev}). 그쪽 바꿈: ${extName("work")} 켜기, ext.helm.maxLenses 4 → 6. 내 바꿈: 이름 "${c.mine}".`,
            `${c.theirs.by} saved first ${c.theirs.at} (rev ${p.rev} → ${c.theirs.rev}). Their changes: turn on ${extName("work")}, ext.helm.maxLenses 4 → 6. Yours: name "${c.mine}".`,
          )}
        </Alert>
      )}
      <div className="flex min-h-8 min-w-0 items-center gap-2">
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              go({ t: "renameSave" });
            }}
          >
            <Input
              size="sm"
              aria-label={L2("프로필 이름", "Profile name")}
              value={s.renameText}
              onChange={(e) => go({ t: "renameText", v: e.target.value })}
              containerClassName="w-64"
              autoFocus
            />
            <Button
              size="sm"
              tone="neutral"
              variant="solid"
              type="submit"
              loading={s.saving}
              disabled={c !== null}
            >
              {L2("저장", "Save")}
            </Button>
            <Button
              size="sm"
              tone="neutral"
              variant="ghost"
              onClick={() => go({ t: "sel", id: p.id })}
            >
              {L2("취소", "Cancel")}
            </Button>
          </form>
        ) : (
          <h2 className="m-0 min-w-0 flex-1 truncate text-ui-strong font-semibold text-text-primary">
            {title(p)}
          </h2>
        )}
        {!renaming && (
          <>
            <Button size="xs" tone="neutral" variant="ghost" disabled={offline}>
              {L2("새 시험 대화로", "New trial conversation")}
            </Button>
            <Button size="xs" tone="neutral" variant="outline" disabled={offline}>
              {L2("이 대화에 적용", "Apply to this conversation")}
            </Button>
          </>
        )}
      </div>
      <p className="-mt-2 m-0 flex min-w-0 flex-wrap gap-x-1.5 text-ui-xs text-text-tertiary">
        <span className="font-mono text-mono-sm">{p.id}</span>
        <span>· rev {p.rev}</span>
        <span>
          · {p.by} · {p.at}
        </span>
      </p>
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={L2("프로필 내용", "Profile contents")}
        className="rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0"
      >
        <ListDescriptionRow term={L2("켜는 것", "Turns on")}>
          <span className="flex flex-wrap gap-x-2">
            {p.enable.map((e) => (
              <span key={e}>
                + {extName(e)}{" "}
                <span className="font-mono text-mono-sm text-text-tertiary">{e}</span>
              </span>
            ))}
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term={L2("끄는 것", "Turns off")}>
          {p.disable.length === 0 ? (
            <span className="text-text-tertiary">{L2("없음", "None")}</span>
          ) : (
            <span className="flex flex-wrap gap-x-2">
              {p.disable.map((e) => (
                <span key={e}>
                  − {extName(e)}{" "}
                  <span className="font-mono text-mono-sm text-text-tertiary">{e}</span>
                </span>
              ))}
            </span>
          )}
        </ListDescriptionRow>
        <ListDescriptionRow
          term={L2("설정 덮어쓰기", "Setting overrides")}
          mono={p.settings.length > 0}
        >
          {p.settings.length === 0 ? (
            <span className="text-text-tertiary">{L2("없음", "None")}</span>
          ) : (
            p.settings.map((x) => `${x.key} = ${x.value}`).join(", ")
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term={L2(`${T.drive} ${T.group}`, `Driving ${T.group.toLowerCase()}`)}>
          {p.driveGroup === null ? L2("자동", "Automatic") : extName(p.driveGroup)}
        </ListDescriptionRow>
        <ListDescriptionRow term={L2("쓰는 곳", "Used by")}>
          {uses.length === 0 ? (
            <span className="text-text-tertiary">{L2("아직 없어요", "Nothing yet")}</span>
          ) : (
            <span className="grid gap-0.5">
              {uses.map((u) => (
                <span key={u.label}>
                  {u.kind === "trial" ? `${T.trialThread} · ` : ""}
                  {L(u.label)} <span className="text-text-tertiary">· {u.note}</span>
                </span>
              ))}
            </span>
          )}
        </ListDescriptionRow>
      </ListDescription>
      <p className="m-0 text-ui-xs text-text-tertiary">
        {L2(
          `내용(켜기·끄기·덮어쓰기)은 ${T.compose}기 캔버스에서 고쳐요. 여기서는 목록만 다뤄요.`,
          `Contents (on, off, overrides) are edited on the ${T.compose.toLowerCase()} canvas. This view manages the list.`,
        )}
      </p>
    </section>
  );
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const look = AT[state];
  const pre = usePrefill(SCRIPTS, look);
  const [s, dispatch] = useMachine<S, A>({
    init: { ...init(), ...look.over },
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const offline = s.load === "offline";

  useEffect(() => {
    if (pre.live && pre.prefill.length === 0 && pre.script === "profile-live")
      dispatch({ t: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (s.toast === null) return;
    toast({
      title: s.toast.title,
      ...(s.toast.description !== undefined ? { description: s.toast.description } : {}),
      tone: s.toast.tone,
      // 정적 상태(스크린숏)는 토스트가 남아 있게.
      duration: pre.live ? 4000 : 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.toast]);

  const compact = shell.layout === "compact";
  const link: StatusCell | undefined = offline
    ? {
        id: "link",
        text: L2("끊김", "Offline"),
        dot: "danger",
        title: T.connection,
        description: L2(
          "엔진에 연결되지 않았어요. 읽은 목록만 보여요.",
          "Not connected to the engine. Showing the last list.",
        ),
      }
    : undefined;

  const hint = (() => {
    switch (pre.script) {
      case "profile-crud":
        return s.dialog === "create"
          ? L2("이름을 넣고 만들기", "Name it, then Create")
          : s.dialog === "delete"
            ? L2("쓰는 곳을 보고 지우기", "Check uses, then Delete")
            : L2(
                "새 프로필 → 행 메뉴(이름 바꾸기·복제·지우기)",
                "New profile → row menu (rename, duplicate, delete)",
              );
      case "profile-conflict":
        return s.conflict !== null
          ? L2("다시 읽기 또는 덮어쓰기", "Reload or overwrite")
          : L2("탐구 중심 메뉴 → 이름 바꾸기 → 저장", "Inquiry-first menu → Rename → Save");
      case "profile-live":
        return L2("잠시 기다리면 다른 기기가 바꿔요", "Wait: another device changes a profile");
      default:
        return undefined;
    }
  })();

  return (
    <>
      <Shell
        activeNav="compose"
        stageLabel={T.compose}
        modalOpen={s.dialog !== null}
        threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
        rightTabs={workbenchRightTabs({ inboxBadge: 2 })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: false,
          pendingApprovals: 1,
          openEnd: shell.openEnd,
          link,
        })}
      >
        <WorkbenchHead
          title={T.compose}
          actions={
            <SegmentedControl
              aria-label={L2("구성 보기", "Composer view")}
              size="xs"
              value="profile"
            >
              <SegmentedControlItem value="group">{T.group}</SegmentedControlItem>
              <SegmentedControlItem value="flow">{L2("흐름", "Flow")}</SegmentedControlItem>
              <SegmentedControlItem value="profile">{T.profile}</SegmentedControlItem>
              <SegmentedControlItem value="code">{L2("코드", "Code")}</SegmentedControlItem>
            </SegmentedControl>
          }
          sub={
            <span>
              {L2(
                `${T.profile} ${s.list.length} · 엔진 호스트에 저장 · 데스크톱·웹·앱이 같은 목록`,
                `${s.list.length} profiles · stored on the engine host · same list on desktop, web and app`,
              )}
            </span>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`${WB_WIDTH} grid gap-3 pt-1 pb-6`}>
            {offline && (
              <Alert tone="warning" layout="inline">
                {L2(
                  "엔진에 연결되면 바꿀 수 있어요 · 마지막으로 읽은 목록 14:03",
                  "You can edit once the engine is connected · last list 14:03",
                )}
              </Alert>
            )}
            {s.load === "empty" ? (
              <EmptyState
                size="sm"
                surface="none"
                title={L2(`${T.profile}이 없어요`, "No profiles yet")}
                description={L2(
                  `${T.profile}은 확장 켜기·끄기와 설정 덮어쓰기 묶음이에요. ${T.trialThread}나 ${T.context}으로 써요.`,
                  `A profile bundles extension on/off and setting overrides. Use it for trial conversations or as the view.`,
                )}
                actions={
                  <Button
                    size="xs"
                    tone="neutral"
                    variant="outline"
                    onClick={() => dispatch({ t: "createOpen" })}
                  >
                    {L2(`새 ${T.profile}`, "New profile")}
                  </Button>
                }
              />
            ) : (
              <div
                className={
                  compact
                    ? "grid gap-4"
                    : "grid grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)] gap-6"
                }
              >
                <div className="grid content-start gap-1.5">
                  <div className="flex h-7 items-center">
                    <h2 className="m-0 flex-1 text-ui-xs font-medium text-text-tertiary">
                      {T.profileManage}
                    </h2>
                    <Button
                      size="xs"
                      tone="neutral"
                      variant="ghost"
                      iconStart={<Plus />}
                      disabled={offline}
                      onClick={() => dispatch({ t: "createOpen" })}
                    >
                      {L2("새 프로필", "New")}
                    </Button>
                  </div>
                  <ProfileList s={s} go={dispatch} offline={offline} />
                </div>
                {s.load === "loading" ? (
                  <div className="grid content-start gap-2 pt-1">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-72" />
                    <Skeleton className="h-4 w-60" />
                  </div>
                ) : (
                  <Detail s={s} go={dispatch} offline={offline} />
                )}
              </div>
            )}
          </div>
        </div>
      </Shell>
      <Dialog
        open={s.dialog === "create"}
        onOpenChange={() => dispatch({ t: "close" })}
        size="sm"
        title={L2(`새 ${T.profile}`, "New profile")}
        footer={
          <>
            <span aria-hidden className="flex-1" />
            <Button
              size="sm"
              tone="neutral"
              variant="ghost"
              onClick={() => dispatch({ t: "close" })}
            >
              {L2("취소", "Cancel")}
            </Button>
            <Button
              size="sm"
              tone="neutral"
              variant="solid"
              onClick={() => dispatch({ t: "create" })}
            >
              {L2("만들기", "Create")}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Input
            size="sm"
            aria-label={L2("이름", "Name")}
            placeholder={L2("이름", "Name")}
            value={s.newName}
            onChange={(e) => dispatch({ t: "createName", v: e.target.value })}
          />
          <p className="m-0 text-ui-xs text-text-secondary">
            {L2(
              `지금 대화(캐시 무효화 조사)의 켜짐 상태에서 시작해요. 내용은 ${T.compose}기에서 고쳐요.`,
              `Starts from what's on in the current conversation (Investigate cache invalidation). Edit the contents in the composer.`,
            )}
          </p>
        </div>
      </Dialog>
      <Dialog
        open={s.dialog === "delete"}
        onOpenChange={() => dispatch({ t: "close" })}
        kind="alert"
        size="sm"
        title={L2(
          `"${L(s.list.find((p) => p.id === s.sel)?.title ?? "")}"을 지울까요?`,
          `Delete "${L(s.list.find((p) => p.id === s.sel)?.title ?? "")}"?`,
        )}
        footer={
          <>
            <span aria-hidden className="flex-1" />
            <Button
              size="sm"
              tone="neutral"
              variant="outline"
              onClick={() => dispatch({ t: "close" })}
            >
              {L2("취소", "Cancel")}
            </Button>
            <Button
              size="sm"
              tone="danger"
              variant="solid"
              onClick={() => dispatch({ t: "delete" })}
            >
              {L2("지우기", "Delete")}
            </Button>
          </>
        }
      >
        <div className="grid gap-2 text-ui-sm text-text-secondary">
          <p className="m-0">
            {L2(
              "이 프로필을 쓰는 곳이 있어요. 시험 대화는 이미 적용한 값을 그대로 갖고, 이 프로필을 보기 기준으로 쓰던 창은 전체로 돌아가요.",
              "Some places use this profile. Trial conversations keep the values already applied; windows viewing by it fall back to Everything.",
            )}
          </p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {(USES[s.sel ?? ""] ?? []).map((u) => (
              <li key={u.label} className="flex items-baseline gap-2">
                <Badge size="xs" tone="neutral" variant="soft">
                  {u.kind === "trial" ? T.trial : T.context}
                </Badge>
                <span className="min-w-0 truncate text-text-primary">{L(u.label)}</span>
                <span className="text-ui-xs text-text-tertiary">{u.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}
