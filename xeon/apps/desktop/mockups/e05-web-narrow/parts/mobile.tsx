// 좁은 폭(720 미만, 웹·앱 전용) 배치(계획에 없음 8, N-59). 데스크톱 창은 최소 720이라 이 폭은 웹과 모바일 앱에서만 생긴다.
// - 전체 화면은 셋: 대화, 받은 요청, 승인. 크래프트는 읽기 전용 목록 하나(켜기·끄기 없음).
// - 왼쪽 패널은 왼쪽 시트(caustic Sheet에 side="left"가 없어 토큰으로 만든 서랍, 빈틈), 오른쪽 well은 아래 시트(Sheet side="bottom").
// - 위 띠 대신 한 줄 머리(48px): 시트 열기 · 제목 · 런타임 · 받은 요청(배지). 누르는 곳은 40px 이상.
import {
  Alert,
  Badge,
  Button,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  Sheet,
} from "@caustic/react";
import type { ReactNode } from "react";
import {
  approvals,
  ChevronLeft,
  ChevronRight,
  extensions,
  inbox,
  Inbox,
  L,
  L2,
  Layers,
  Menu,
  MessageSquare,
  NoticeList,
  Package,
  Settings,
  T,
  threads,
  type Layout,
} from "../../_shell";
import {
  ChatComposer,
  Items,
  RuntimePanel,
  t1Base,
  t1Runtime,
  type ChatItem,
} from "../../_chat-rt";
import { ExtTable } from "../../e04-workbench-states/parts/ext-table";
import type { A, S } from "../flow";

const T2: ChatItem[] = [
  { k: "user", text: "느린 테스트 다섯 개만 골라줘" },
  { k: "agent", text: "시간 순으로 정렬했어요. cache, sync, migrate, index, render 순이에요." },
];

function Top({
  title,
  back,
  s,
  go,
  sub,
}: {
  title: ReactNode;
  back?: () => void;
  s: S;
  go: (a: A) => void;
  sub?: ReactNode;
}) {
  return (
    <header className="flex h-12 flex-none items-center gap-1 px-1.5">
      {back !== undefined ? (
        <IconButton size="lg" variant="ghost" label={L2("뒤로", "Back")} onClick={back}>
          <ChevronLeft />
        </IconButton>
      ) : (
        <IconButton
          size="lg"
          variant="ghost"
          label={L2("왼쪽 패널", "Left panel")}
          onClick={() => go({ t: "sheet", v: "left" })}
        >
          <Menu />
        </IconButton>
      )}
      <div className="grid min-w-0 flex-1">
        <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">{title}</h1>
        {sub !== undefined && <span className="truncate text-ui-xs text-text-tertiary">{sub}</span>}
      </div>
      {back === undefined && (
        <IconButton
          size="lg"
          variant="ghost"
          label={T.runtime}
          onClick={() => go({ t: "sheet", v: "well" })}
        >
          <Layers />
        </IconButton>
      )}
      {back === undefined && (
        <span className="relative">
          <IconButton
            size="lg"
            variant="ghost"
            label={L2(`${T.inbox} ${s.badge}개`, `${T.inbox}, ${s.badge}`)}
            onClick={() => go({ t: "go", m: "inbox" })}
          >
            <Inbox />
          </IconButton>
          {s.badge > 0 && (
            <span
              aria-hidden
              className="absolute end-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-solid px-1 text-ui-xs font-semibold text-accent-on tabular-nums"
            >
              {s.badge}
            </span>
          )}
        </span>
      )}
    </header>
  );
}

/** 앱 안 알림 띠(탭이 보일 때). 브라우저 탭이 뒤에 있으면 브라우저 알림(권한 필요), 앱이면 OS 알림이 대신한다. */
function Banner({ go }: { go: (a: A) => void }) {
  return (
    <div
      role="status"
      className="absolute inset-x-2 top-2 z-30 flex items-center gap-3 rounded-2xl bg-surface-raised p-3 shadow-3 animate-enter"
    >
      <Inbox aria-hidden className="size-icon-md flex-none text-text-secondary" />
      <div className="grid min-w-0 flex-1">
        <span className="truncate text-ui-sm font-medium text-text-primary">
          {L2("승인 요청 · 캐시 무효화 조사", "Approval request · Investigate cache invalidation")}
        </span>
        <span className="truncate font-mono text-mono-sm text-text-secondary">
          bash · rm -rf .cache && bun test
        </span>
      </div>
      <Button
        size="sm"
        tone="neutral"
        variant="outline"
        onClick={() => go({ t: "go", m: "inbox" })}
      >
        {L2("보기", "View")}
      </Button>
    </div>
  );
}

function InboxScreen({ s, go }: { s: S; go: (a: A) => void }) {
  const a = approvals.a1;
  return (
    <>
      <Top title={T.inbox} back={() => go({ t: "go", m: "other" })} s={s} go={go} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <h2 className="m-0 mb-1 text-ui-xs font-medium text-text-tertiary">
          {L2("답을 기다림", "Waiting for you")}
        </h2>
        <ul className="m-0 mb-4 grid list-none gap-1 p-0">
          <li>
            <button
              type="button"
              onClick={() => go({ t: "go", m: "approve" })}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-surface-raised px-3 py-2 text-left shadow-1 outline-none focus-visible:focus-ring"
            >
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-ui-sm font-medium text-text-primary">
                  {s.decision === "allowed"
                    ? L2("허용했어요 · bash", "Allowed · bash")
                    : s.decision === "elsewhere"
                      ? L2("데스크톱에서 답함 · bash", "Answered on desktop · bash")
                      : `${T.approvalTool} · bash`}
                </span>
                <span className="truncate text-ui-xs text-text-secondary">
                  {L(a.thread)} · core · {L2("지금", "now")}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-icon-sm text-text-tertiary" />
            </button>
          </li>
          <li>
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none hover:bg-fill-hover focus-visible:focus-ring"
            >
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-ui-sm font-medium text-text-primary">
                  {T.approvalQuestion} ·{" "}
                  {L2("어느 테스트 묶음부터 볼까요?", "Which test suite first?")}
                </span>
                <span className="truncate text-ui-xs text-text-secondary">
                  {L(approvals.a2.thread)} · grp:helm · {L2("3분 전", "3 min ago")}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-icon-sm text-text-tertiary" />
            </button>
          </li>
        </ul>
        <h2 className="m-0 mb-1 text-ui-xs font-medium text-text-tertiary">
          {L2("알림", "Notifications")}
        </h2>
        <NoticeList notices={inbox.notices} />
      </div>
    </>
  );
}

function ApproveScreen({ s, go }: { s: S; go: (a: A) => void }) {
  const a = approvals.a1;
  const done = s.decision === "elsewhere";
  return (
    <>
      <Top
        title={`${T.approvalTool} · bash`}
        sub={`${L(a.thread)} · core · 14:05`}
        back={() => go({ t: "go", m: "inbox" })}
        s={s}
        go={go}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {done && (
          <Alert tone="neutral" size="sm" className="mb-3">
            {L2(
              "데스크톱에서 이미 허용했어요(14:06). 이 요청은 끝났어요.",
              "Already allowed on the desktop (14:06). This request is closed.",
            )}
          </Alert>
        )}
        <ListDescription
          variant="ghost"
          size="sm"
          aria-label={L2("승인 상세", "Approval details")}
          className="rounded-none [--cs-size-list-term:6.5rem] [&_[data-slot=list-description-row]]:px-0"
        >
          <ListDescriptionRow term={L2("명령", "Command")} mono>
            <span className="break-all whitespace-pre-wrap">{a.command}</span>
          </ListDescriptionRow>
          <ListDescriptionRow term={L("위험도")}>
            <Badge size="xs" tone="warning">
              {a.risk}
            </Badge>
          </ListDescriptionRow>
          <ListDescriptionRow term={L2("시크릿", "Secret")} mono>
            <span className="break-all">GH_TOKEN ← secret://github-token</span>
          </ListDescriptionRow>
          <ListDescriptionRow term="cwd" mono>
            ~/code/fresnel
          </ListDescriptionRow>
        </ListDescription>
      </div>
      <div className="grid flex-none grid-cols-[1fr_1fr] gap-2 px-3 pt-2 pb-3">
        <Button
          size="lg"
          tone="neutral"
          variant="outline"
          disabled={done}
          onClick={() => go({ t: "decide", d: "denied" })}
        >
          {L("거부")}
        </Button>
        <Button
          size="lg"
          tone="neutral"
          variant="solid"
          disabled={done}
          onClick={() => go({ t: "decide", d: "allowed" })}
        >
          {L("허용")}
        </Button>
        <Button size="md" tone="neutral" variant="ghost" disabled={done} className="col-span-2">
          {L("이 대화에서 항상")}
        </Button>
      </div>
    </>
  );
}

function LeftSheet({ s, go }: { s: S; go: (a: A) => void }) {
  if (s.sheet !== "left") return null;
  const list = threads.filter((t) => t.folder === "~/code/fresnel" && t.trial === undefined);
  const row = (icon: ReactNode, label: string, onClick: () => void, meta?: ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-ui-sm text-text-primary outline-none hover:bg-fill-hover focus-visible:focus-ring"
    >
      <span aria-hidden className="inline-flex text-text-secondary [&_svg]:size-icon-md">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta}
    </button>
  );
  return (
    <div className="absolute inset-0 z-40 flex">
      <nav
        aria-label={L2("왼쪽 패널", "Left panel")}
        className="flex h-full w-[min(20rem,85%)] flex-col bg-surface-base shadow-3 animate-enter-panel enter-from-start"
      >
        <div className="grid gap-0.5 p-2">
          {row(<MessageSquare />, T.thread, () => go({ t: "go", m: "chat" }))}
          {row(
            <Inbox />,
            T.inbox,
            () => go({ t: "go", m: "inbox" }),
            <span className="text-ui-xs tabular-nums text-text-secondary">{s.badge}</span>,
          )}
          {row(
            <Package />,
            T.workbench,
            () => go({ t: "go", m: "workbench" }),
            <Badge size="xs" tone="neutral" variant="soft">
              {T.readOnly}
            </Badge>,
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <h2 className="m-0 px-2.5 pb-1 font-mono text-mono-sm text-text-tertiary">
            ~/code/fresnel
          </h2>
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go({ t: "go", m: t.id === "t1" ? "chat" : "other" })}
              className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-ui-sm text-text-primary hover:bg-fill-hover"
            >
              <span className="min-w-0 flex-1 truncate">{L(t.title)}</span>
              {t.approvals > 0 && (
                <span className="text-ui-xs text-text-tertiary">
                  {L2(`승인 ${t.approvals}`, `${t.approvals} to approve`)}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="p-2">{row(<Settings />, L("설정"), () => {})}</div>
      </nav>
      <button
        type="button"
        aria-label={L2("닫기", "Close")}
        className="flex-1 bg-bg-scrim"
        onClick={() => go({ t: "sheet", v: null })}
      />
    </div>
  );
}

export function MobileApp({ s, go, layout }: { s: S; go: (a: A) => void; layout: Layout }) {
  let body: ReactNode;
  if (s.m === "inbox") body = <InboxScreen s={s} go={go} />;
  else if (s.m === "approve") body = <ApproveScreen s={s} go={go} />;
  else if (s.m === "workbench")
    body = (
      <>
        <Top
          title={T.extension}
          sub={L2(`${T.workbench} · ${T.readOnly}`, `${T.workbench} · ${T.readOnly}`)}
          s={s}
          go={go}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className="m-0 mb-2 text-ui-xs text-text-secondary">
            {L2(
              "작은 화면에서는 읽기만 해요. 켜기·끄기와 구성은 넓은 창에서 해요.",
              "Small screens are read-only. Turn things on or off and compose on a wider window.",
            )}
          </p>
          <ExtTable rows={extensions} layout={layout} readOnly />
        </div>
      </>
    );
  else {
    const other = s.m === "other";
    body = (
      <>
        <Top
          title={other ? L("테스트 정리") : L("캐시 무효화 조사")}
          sub={
            other
              ? undefined
              : L2(`Helm ${T.drive} · ${T.inquiry} 수렴`, "Helm is driving · inquiry converging")
          }
          s={s}
          go={go}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <div className="grid gap-3 pb-3">
            <Items items={other ? T2 : t1Base} />
            {!other && s.decision === "pending" && (
              <button
                type="button"
                onClick={() => go({ t: "go", m: "approve" })}
                className="flex min-h-14 items-center gap-3 rounded-xl bg-surface-raised px-3 py-2 text-left shadow-1"
              >
                <span className="grid min-w-0 flex-1">
                  <span className="text-ui-sm font-medium text-text-primary">{`${T.approvalTool} · bash`}</span>
                  <span className="truncate font-mono text-mono-sm text-text-secondary">
                    rm -rf .cache && bun test
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-icon-sm text-text-tertiary" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-none px-2 pb-2">
          <ChatComposer value="" onValueChange={() => {}} running={false} onSubmit={() => {}} />
        </div>
      </>
    );
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {body}
      {s.banner && s.m === "other" && <Banner go={go} />}
      <LeftSheet s={s} go={go} />
      <Sheet
        side="bottom"
        open={s.sheet === "well"}
        onOpenChange={(o) => go({ t: "sheet", v: o ? "well" : null })}
        title={T.runtime}
        closeLabel={L2("닫기", "Close")}
      >
        <RuntimePanel data={t1Runtime()} />
      </Sheet>
    </div>
  );
}
