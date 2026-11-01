// e05 웹·좁은 폭·원격 작업대(묶음 E): 웹 첫 화면과 연결 상태(계획에 없음 7), 720 미만 배치(계획에 없음 8, N-59), 원격 대상 작업대(N-60).
// 웹 상태는 목업 전용 브라우저 틀 안에 그린다(데스크톱 셸 밖). 연결된 뒤에는 같은 셸이 브라우저 안에서 돈다.
import { Alert, Button, IconButton, Menu, MenuItem, MenuSeparator, toast } from "@caustic/react";
import { useEffect, useState } from "react";
import {
  chatRightTabs,
  Copy,
  defaultStatusCells,
  Ellipsis,
  extensions,
  extName,
  inbox,
  L,
  L2,
  NoticeList,
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
import {
  ChatComposer,
  ChatHead,
  ChatStage,
  Items,
  RuntimePanel,
  t1Base,
  t1Runtime,
  t1RuntimeLine,
  useMachine,
  usePrefill,
} from "../_chat-rt";
import { SettingsFrame } from "../_settings/frame";
import { SettingRow, SettingSection } from "../_settings/row";
import { ExtTable } from "../e04-workbench-states/parts/ext-table";
import { effect, init, reduce, SCRIPTS, type A, type S } from "./flow";
import { MobileApp } from "./parts/mobile";
import { BrowserFrame, WebLogin } from "./parts/web";

type Surface = "web" | "mobile" | "remote" | "settings";
interface Look {
  script: string;
  n: number;
  surface: Surface;
  over?: Partial<S>;
  view?: "ext" | "views";
}

export const STATES = [
  { id: "web-login", label: "웹 첫 화면" },
  { id: "web-connecting", label: "웹 연결 중" },
  { id: "web-bad-token", label: "웹 토큰 틀림" },
  { id: "web-unreachable", label: "웹 서비스에 닿지 못함" },
  { id: "web-live", label: "웹 연결됨(대화)" },
  { id: "web-reconnecting", label: "웹 다시 연결 중" },
  { id: "web-offline", label: "웹 오프라인" },
  { id: "web-reconnected", label: "웹 다시 연결됨" },
  { id: "m-chat", label: "좁은 폭 대화(390)" },
  { id: "m-banner", label: "좁은 폭 다른 대화 + 알림 띠" },
  { id: "m-inbox", label: "좁은 폭 받은 요청" },
  { id: "m-approve", label: "좁은 폭 승인" },
  { id: "m-approved", label: "좁은 폭 승인 뒤" },
  { id: "m-elsewhere", label: "좁은 폭 다른 곳에서 답함" },
  { id: "m-left-sheet", label: "좁은 폭 왼쪽 시트" },
  { id: "m-well-sheet", label: "좁은 폭 well 아래 시트" },
  { id: "m-workbench", label: "좁은 폭 작업대(읽기 전용)" },
  { id: "m-settings", label: "좁은 폭 설정(탭 → Select)" },
  { id: "remote-ext", label: "원격 작업대 확장 목록" },
  { id: "remote-denied", label: "원격 켜기 권한 없음" },
  { id: "remote-menu", label: "원격 행 메뉴(경로 복사)" },
  { id: "remote-views", label: "원격 화면 탭(프레임 파일)" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, Look> = {
  "web-login": { script: "base", n: 0, surface: "web" },
  "web-connecting": { script: "web-login", n: 5, surface: "web" },
  "web-bad-token": { script: "web-login", n: 3, surface: "web" },
  "web-unreachable": { script: "web-unreachable", n: 3, surface: "web" },
  "web-live": { script: "web-login", n: 6, surface: "web" },
  "web-reconnecting": { script: "web-login", n: 7, surface: "web" },
  "web-offline": { script: "web-login", n: 8, surface: "web" },
  "web-reconnected": { script: "web-login", n: 10, surface: "web" },
  "m-chat": { script: "base", n: 0, surface: "mobile" },
  "m-banner": { script: "mobile-approve", n: 1, surface: "mobile" },
  "m-inbox": { script: "mobile-approve", n: 2, surface: "mobile" },
  "m-approve": { script: "mobile-approve", n: 3, surface: "mobile" },
  "m-approved": { script: "mobile-approve", n: 4, surface: "mobile" },
  "m-elsewhere": { script: "mobile-approve-expired", n: 4, surface: "mobile" },
  "m-left-sheet": { script: "m-left", n: 1, surface: "mobile" },
  "m-well-sheet": { script: "m-well", n: 1, surface: "mobile" },
  "m-workbench": { script: "m-wb", n: 1, surface: "mobile" },
  "m-settings": { script: "base", n: 0, surface: "settings" },
  "remote-ext": { script: "base", n: 0, surface: "remote" },
  "remote-denied": { script: "remote-enable", n: 2, surface: "remote" },
  "remote-menu": { script: "remote-menu", n: 1, surface: "remote" },
  "remote-views": { script: "base", n: 0, surface: "remote", view: "views" },
};

export const SCENARIOS = [
  { id: "web-login", label: "웹: 토큰 틀림 → 연결 → 끊김 → 다시 연결" },
  { id: "web-unreachable", label: "실패: 웹 서비스에 닿지 못함" },
  { id: "mobile-approve", label: "390: 알림 띠 → 받은 요청 → 허용" },
  { id: "mobile-approve-expired", label: "실패: 390 허용했는데 데스크톱이 먼저 답함" },
  { id: "remote-enable", label: "실패: 원격 대상에서 확장 켜기 → 권한 없음" },
];

function WebChat({ s, go }: { s: S; go: (a: A) => void }) {
  const shell = useShell();
  const [draft, setDraft] = useState("");
  const down = s.conn === "reconnecting" || s.conn === "offline";
  const target: StatusCell = {
    id: "target",
    text: `${T.webClient} · build-box`,
    title: L("대상"),
    description: L2(
      "이 탭은 build-box의 서비스에 붙어 있어요. 웹은 대상을 바꾸지 않아요.",
      "This tab is attached to the service on build-box. The web client doesn't switch targets.",
    ),
  };
  const link: StatusCell | undefined = down
    ? {
        id: "link",
        text:
          s.conn === "offline"
            ? L2("끊김", "Offline")
            : L2(`다시 연결 중 ${s.attempt}`, `Reconnecting ${s.attempt}`),
        dot: s.conn === "offline" ? "danger" : "warning",
        title: T.connection,
        description:
          s.conn === "offline"
            ? L2(
                "서비스에 닿지 않아요. 읽은 대화는 그대로 보여요.",
                "Can't reach the service. Loaded conversations stay visible.",
              )
            : L2(
                "다시 맞추는 중이에요. 끊긴 동안의 스트리밍 조각은 버리고 완성된 항목만 받아요.",
                "Resyncing. Partial streams from the gap are dropped; completed items are fetched.",
              ),
        ...(s.conn === "offline"
          ? {
              action: {
                label: L2("지금 다시 연결", "Reconnect now"),
                onSelect: () => go({ t: "retryConn" }),
              },
            }
          : {}),
      }
    : undefined;
  const status = defaultStatusCells({
    layout: shell.layout,
    thread: true,
    pendingApprovals: 1,
    openEnd: shell.openEnd,
    target,
    link,
    runtime: down
      ? undefined
      : { drive: "helm", extFailures: 0, onOpen: () => shell.openEnd("runtime") },
  });
  // 웹은 엔진 칸이 없다(서비스 쪽 일).
  const start = status.start.filter((c) => c.id !== "engine");
  return (
    <Shell
      activeNav="chat"
      stageLabel={T.thread}
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {}, dimmed: down }}
      rightTabs={chatRightTabs({
        inbox: <NoticeList notices={inbox.notices} />,
        inboxBadge: 3,
        runtime: <RuntimePanel data={t1Runtime()} />,
      })}
      status={{ start, end: status.end }}
    >
      <ChatStage
        follow={`${s.conn}-${s.missed}`}
        head={
          <ChatHead
            title={L("캐시 무효화 조사")}
            runtime={
              down
                ? L2(`${T.connection} 끊김 · 읽기만 돼요`, "Disconnected · read-only")
                : t1RuntimeLine
            }
          />
        }
        band={
          s.conn === "offline" ? (
            <Alert
              tone="warning"
              layout="inline"
              size="sm"
              actions={[
                {
                  label: L2("지금 다시 연결", "Reconnect now"),
                  onClick: () => go({ t: "retryConn" }),
                },
              ]}
            >
              {L2(
                "build-box 서비스와 연결이 끊겼어요. 쓰던 글은 남고, 다시 연결되면 보낼 수 있어요.",
                "Lost the connection to build-box. Your draft stays; send once reconnected.",
              )}
            </Alert>
          ) : undefined
        }
        composer={
          <ChatComposer
            value={draft}
            onValueChange={setDraft}
            running={false}
            disabled={down}
            onSubmit={() => setDraft("")}
          />
        }
      >
        <Items
          items={[
            ...t1Base,
            ...(s.missed > 0
              ? [
                  {
                    k: "row" as const,
                    text: L2("끊긴 동안 온 항목 2개", "2 items arrived while disconnected"),
                    source: "core",
                    icon: "clock" as const,
                  },
                  {
                    k: "agent" as const,
                    text: L2(
                      "ttl 비교를 초 단위로 고쳤어요. 시험 12개가 모두 통과해요.",
                      "Fixed the ttl comparison to seconds. All 12 tests pass.",
                    ),
                  },
                ]
              : []),
          ]}
        />
      </ChatStage>
    </Shell>
  );
}

function RemoteWorkbench({ s, go, view }: { s: S; go: (a: A) => void; view: "ext" | "views" }) {
  const shell = useShell();
  const target: StatusCell = {
    id: "target",
    text: `${T.remoteTarget} · build-box`,
    title: T.remoteTarget,
    description: L2(
      "build-box의 엔진을 보고 있어요. 확장 파일은 그 컴퓨터에 있어요.",
      "Viewing the engine on build-box. Extension files live on that computer.",
    ),
  };
  const lock = L2(
    "이 연결 토큰은 확장 켜기·끄기 권한(ext.manage)이 없어요",
    "This connection token lacks the extension on/off permission (ext.manage)",
  );
  const rows = extensions.map((e) =>
    e.name === "review" && s.pending === "review" ? { ...e } : e,
  );
  return (
    <Shell
      activeNav="extensions"
      stageLabel={T.extension}
      threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
      rightTabs={workbenchRightTabs({ inboxBadge: 1 })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 1,
        openEnd: shell.openEnd,
        target,
      })}
    >
      {view === "ext" ? (
        <>
          <WorkbenchHead
            title={T.extension}
            meta={`build-box`}
            actions={
              <Button size="xs" tone="neutral" variant="ghost" disabled>
                {L2("가져오기", "Import")}
              </Button>
            }
            sub={
              <span>
                {L2(
                  `${T.extension} ${extensions.length} · ${T.remoteTarget} build-box · 바꾸기 권한 없음`,
                  `${extensions.length} extensions · remote build-box · no permission to change`,
                )}
              </span>
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={`${WB_WIDTH} grid gap-3 pt-1 pb-6`}>
              {s.denied ? (
                <Alert
                  tone="danger"
                  actions={[{ label: L2("권한 안내 복사", "Copy permission note"), primary: true }]}
                >
                  {L2(
                    `${extName("review")} 켜기를 build-box가 거부했어요 · 권한 없음(ext.manage). build-box의 ${T.productName} 앱 › 연결 › 웹 접속에서 이 토큰에 "확장 관리"를 더하면 돼요.`,
                    `build-box refused to turn on ${extName("review")} · missing permission (ext.manage). Add "Manage extensions" to this token in the ${T.productName} app on build-box › Connection › Web access.`,
                  )}
                </Alert>
              ) : (
                <Alert tone="neutral" layout="inline" size="sm">
                  {L2(
                    "읽기 토큰으로 붙어 있어요. 켜기·끄기를 누르면 build-box에 권한을 물어요.",
                    "Attached with a read token. Turning something on or off asks build-box for permission.",
                  )}
                </Alert>
              )}
              <ExtTable
                rows={rows}
                layout={shell.layout}
                onToggle={(name) => go({ t: "toggle", name })}
                rowMenu={(e) => (
                  // 원격이면 폴더·파일 열기 대신 경로 복사(N-60).
                  <Menu
                    size="sm"
                    align="end"
                    open={s.menu === e.name ? true : undefined}
                    onOpenChange={(o) => go({ t: "menu", name: o ? e.name : null })}
                    aria-label={`${extName(e.name)} ${L("메뉴")}`}
                    trigger={
                      <IconButton
                        size="xs"
                        variant="ghost"
                        label={`${extName(e.name)} ${L("메뉴")}`}
                      >
                        <Ellipsis />
                      </IconButton>
                    }
                  >
                    <MenuItem>{L2("자세히", "Details")}</MenuItem>
                    <MenuItem>{L2("기록", "Log")}</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Copy />}>{T.copyPath}</MenuItem>
                    <MenuItem disabled>
                      {L2("폴더 열기 · 원격이라 못 열어요", "Open folder · not on this computer")}
                    </MenuItem>
                  </Menu>
                )}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <WorkbenchHead
            title={extName("acme-notes")}
            meta={`acme-notes · plugin · ${T.trustProject} · 0.0.9 · build-box`}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={`${WB_WIDTH} grid gap-3 pt-1 pb-6`}>
              <h2 className="m-0 text-ui-dense font-semibold text-text-primary">
                {L2("화면", "Views")}
              </h2>
              <div className="grid gap-1 text-ui-dense">
                <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-3 text-ui-xs text-text-tertiary">
                  <span>{L2("화면", "View")}</span>
                  <span>slot</span>
                  <span>{T.viewMode}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-3">
                  <span className="truncate text-text-primary">
                    {L2("노트 보드", "Notes board")}{" "}
                    <span className="font-mono text-mono-sm text-text-tertiary">
                      acme-notes/board
                    </span>
                  </span>
                  <span className="text-text-secondary">{T.slotPage}</span>
                  <span className="text-text-secondary">{T.viewFrame}</span>
                </div>
              </div>
              <Alert tone="neutral" size="sm">
                {L2(
                  "프레임 파일은 build-box에 있어요(build-box:~/.fresnel/extensions/acme-notes/view/index.html). 서비스가 격리된 주소로 보내 주고, 이 컴퓨터에는 저장하지 않아요. 파일을 고치려면 그 컴퓨터에서 열어요.",
                  "The frame files live on build-box (build-box:~/.fresnel/extensions/acme-notes/view/index.html). The service serves them from an isolated origin; nothing is saved here. Edit them on that computer.",
                )}
              </Alert>
              <div className="flex gap-1.5">
                <Button size="xs" tone="neutral" variant="outline" iconStart={<Copy />}>
                  {T.copyPath}
                </Button>
                <Button size="xs" tone="neutral" variant="ghost" disabled>
                  {L2("파일 열기 · 원격", "Open file · remote")}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
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

  useEffect(() => {
    if (pre.live && pre.prefill.length === 0 && pre.script.startsWith("mobile-approve"))
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

  const hint = (() => {
    switch (pre.script) {
      case "web-login":
        return s.conn === "idle" || s.conn === "authFailed"
          ? L2("토큰 xk_wrong… 또는 xk_live…로 연결", "Connect with xk_wrong… or xk_live…")
          : s.conn === "offline"
            ? L2("지금 다시 연결", "Reconnect now")
            : undefined;
      case "web-unreachable":
        return L2("연결 → 다시 시도", "Connect → Try again");
      case "mobile-approve":
      case "mobile-approve-expired":
        return s.m === "other"
          ? L2("띠의 보기 또는 받은 요청 아이콘", "Banner View or the inbox icon")
          : s.m === "inbox"
            ? L2("bash 요청", "The bash request")
            : s.m === "approve"
              ? L2("허용", "Allow")
              : undefined;
      case "remote-enable":
        return L2(`${extName("review")} 켜기 스위치`, `${extName("review")} switch`);
      default:
        return undefined;
    }
  })();

  let page;
  if (look.surface === "web") {
    page = (
      <BrowserFrame
        title={
          s.conn === "live" || s.conn === "reconnecting" || s.conn === "offline"
            ? `${L("캐시 무효화 조사")} · ${T.productName}`
            : L2(`${T.productName} · 연결`, `${T.productName} · Connect`)
        }
      >
        {s.conn === "live" || s.conn === "reconnecting" || s.conn === "offline" ? (
          <WebChat s={s} go={dispatch} />
        ) : (
          <WebLogin
            s={s}
            onToken={(v) => dispatch({ t: "token", v })}
            onConnect={() => dispatch({ t: "connect" })}
          />
        )}
      </BrowserFrame>
    );
  } else if (look.surface === "mobile") {
    page = <MobileApp s={s} go={dispatch} layout={shell.layout} />;
  } else if (look.surface === "settings") {
    page = (
      <SettingsFrame tab="appearance" onTabSelect={() => {}}>
        <SettingSection title={L2("화면", "Display")}>
          <SettingRow label={T.uiLanguage} k="ui.locale" scope="user" apply="now" />
          <SettingRow
            label={T.reducedMotion}
            k="l4.desktop.appearance.motion"
            scope="user"
            apply="now"
          />
        </SettingSection>
      </SettingsFrame>
    );
  } else {
    page = <RemoteWorkbench s={s} go={dispatch} view={look.view ?? "ext"} />;
  }

  return (
    <>
      {page}
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}
