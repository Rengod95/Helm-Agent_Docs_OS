// e04 크래프트 여섯 상태 빈칸(N-47)과 찾기·거르기 결과 없음(N-48). 묶음 E.
// P-13 확장 목록(읽는 중·빈·거르기 결과 없음·읽기 실패), P-17 확장 상세(탭별 읽는 중·오프라인·빈·오류), P-20 측정(읽는 중·50개 넘음·빈·계측 꺼짐),
// 팔레트 결과 없음(대화·크래프트), P-06 제안 거르기 결과 없음, P-09 키 찾기 결과 없음.
import { Button, toast } from "@caustic/react";
import { useEffect } from "react";
import {
  chatRightTabs,
  defaultStatusCells,
  L2,
  ScenarioDock,
  Shell,
  ShellToaster,
  T,
  useShell,
  workbenchRightTabs,
  type StatusCell,
} from "../_shell";
import { SettingsFrame } from "../_settings/frame";
import { useMachine, usePrefill } from "../_chat-rt";
import {
  effect,
  init,
  reduce,
  SCRIPTS,
  type A,
  type MetricsMode,
  type S,
  type Screen,
  type TabMode,
} from "./flow";
import {
  DetailScreen,
  ExtListScreen,
  MetricsScreen,
  NoMatch,
  ProposalsFilterEmpty,
} from "./parts/screens";

interface Look {
  script: string;
  n: number;
  screen: Screen;
  over?: Partial<S>;
  tabMode?: TabMode;
  metrics?: MetricsMode;
  userOnly?: boolean;
  area?: "chat" | "workbench";
}

export const STATES = [
  { id: "ext-list", label: "P-13 확장 목록" },
  { id: "ext-loading", label: "P-13 읽는 중" },
  { id: "ext-empty", label: "P-13 빈(사용자 확장 없음)" },
  { id: "ext-filter-empty", label: "P-13 거르기 결과 없음" },
  { id: "ext-error", label: "P-13 읽기 실패" },
  { id: "detail-loading", label: "P-17 탭 읽는 중" },
  { id: "detail-offline", label: "P-17 오프라인" },
  { id: "detail-empty", label: "P-17 빈 탭(화면)" },
  { id: "detail-error", label: "P-17 탭 오류" },
  { id: "metrics-loading", label: "P-20 읽는 중" },
  { id: "metrics-many", label: "P-20 50개 넘음" },
  { id: "metrics-empty", label: "P-20 빈(기간)" },
  { id: "metrics-off", label: "P-20 계측 꺼짐" },
  { id: "palette-empty", label: "팔레트 결과 없음(대화)" },
  { id: "palette-empty-wb", label: "팔레트 결과 없음(크래프트)" },
  { id: "proposals-empty", label: "P-06 거르기 결과 없음" },
  { id: "settings-empty", label: "P-09 키 찾기 결과 없음" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, Look> = {
  "ext-list": { script: "base", n: 0, screen: "ext" },
  "ext-loading": { script: "list-load-fail", n: 1, screen: "ext" },
  "ext-empty": { script: "base", n: 0, screen: "ext", userOnly: true },
  "ext-filter-empty": { script: "filter-empty", n: 2, screen: "ext" },
  "ext-error": { script: "list-load-fail", n: 2, screen: "ext" },
  "detail-loading": { script: "base", n: 0, screen: "detail", tabMode: "loading" },
  "detail-offline": { script: "base", n: 0, screen: "detail", tabMode: "offline" },
  "detail-empty": {
    script: "base",
    n: 0,
    screen: "detail",
    tabMode: "empty",
    over: { tab: "views" },
  },
  "detail-error": {
    script: "base",
    n: 0,
    screen: "detail",
    tabMode: "error",
    over: { tab: "lease" },
  },
  "metrics-loading": { script: "base", n: 0, screen: "metrics", metrics: "loading" },
  "metrics-many": { script: "base", n: 0, screen: "metrics", metrics: "many" },
  "metrics-empty": { script: "base", n: 0, screen: "metrics", metrics: "empty" },
  "metrics-off": { script: "base", n: 0, screen: "metrics", metrics: "off" },
  "palette-empty": { script: "base", n: 0, screen: "palette", area: "chat" },
  "palette-empty-wb": { script: "base", n: 0, screen: "palette", area: "workbench" },
  "proposals-empty": { script: "base", n: 0, screen: "proposals", area: "chat" },
  "settings-empty": { script: "base", n: 0, screen: "settings" },
};

export const SCENARIOS = [
  { id: "filter-empty", label: "거르기: lint → 층 L3 → 결과 없음 → 지우기" },
  { id: "list-load-fail", label: "실패: 확장 목록 읽기 실패 → 다시 읽기" },
];

const NAV: Record<Screen, string> = {
  ext: "extensions",
  detail: "extensions",
  metrics: "metrics",
  proposals: "proposals",
  settings: "settings",
  palette: "chat",
};

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const look = AT[state];
  const pre = usePrefill(SCRIPTS, look);
  const [s, dispatch] = useMachine<S, A>({
    init: { ...init(), screen: look.screen, ...look.over },
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });

  useEffect(() => {
    if (pre.live && pre.prefill.length === 0 && pre.script === "list-load-fail")
      dispatch({ t: "load" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (pre.script === "list-load-fail" && s.list === "ready" && s.tries > 0 && pre.live)
      toast({
        title: L2(`${T.extension} 목록을 다시 읽었어요`, "Reloaded the extension list"),
        tone: "success",
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.list]);

  if (look.screen === "settings")
    return (
      <SettingsFrame
        tab="appearance"
        onTabSelect={() => {}}
        query="zoomlevel"
        tabCounts={{}}
        title={L2(`"zoomlevel" 찾기`, `Search "zoomlevel"`)}
      >
        <NoMatch
          what={`"zoomlevel"`}
          onClear={() => {}}
          clearLabel={L2("찾기 지우기", "Clear search")}
          extra={
            <Button size="sm" tone="neutral" variant="ghost">
              {L2("비슷한 설정 열기", "Open a similar setting")}
            </Button>
          }
        />
      </SettingsFrame>
    );

  const offline = look.tabMode === "offline";
  const link: StatusCell | undefined = offline
    ? {
        id: "link",
        text: L2("끊김", "Offline"),
        dot: "danger",
        title: T.connection,
        // _shell 상태 칸의 description은 필수(칸 설명을 항상 그린다). 연결 끊김 칸은 마지막 값이 어디서 왔는지 한 줄 남긴다.
        description: L2(
          "엔진에 연결되지 않았어요. 마지막 값만 보여요.",
          "Not connected. Showing last values.",
        ),
      }
    : undefined;
  const area = look.area ?? "workbench";
  const hint =
    pre.script === "filter-empty"
      ? s.q === ""
        ? L2("찾기 칸에 lint → 층 L3", "Type lint → layer L3")
        : L2("거르기 지우기", "Clear filters")
      : pre.script === "list-load-fail"
        ? s.list === "error"
          ? L2("Alert의 다시 읽기", "Reload in the alert")
          : undefined
        : undefined;

  return (
    <>
      <Shell
        activeNav={NAV[look.screen]}
        stageLabel={T.workbench}
        threads={{ currentId: area === "chat" ? "t1" : null, onSelect: () => {}, onNew: () => {} }}
        rightTabs={
          area === "chat" ? chatRightTabs({ inboxBadge: 3 }) : workbenchRightTabs({ inboxBadge: 2 })
        }
        status={defaultStatusCells({
          layout: shell.layout,
          thread: area === "chat",
          pendingApprovals: 1,
          openEnd: shell.openEnd,
          link,
        })}
        {...(look.screen === "palette"
          ? {
              paletteQuery: area === "chat" ? "rollback" : "ext.helm.maxLenses",
              paletteEmpty:
                area === "chat"
                  ? L2(
                      `"rollback"와 맞는 명령·대화가 없어요`,
                      `No command or conversation matches "rollback"`,
                    )
                  : L2(
                      `"ext.helm.maxLenses"와 맞는 항목이 없어요`,
                      `Nothing matches "ext.helm.maxLenses"`,
                    ),
            }
          : {})}
      >
        {look.screen === "ext" && (
          <ExtListScreen
            s={s}
            layout={shell.layout}
            userOnly={look.userOnly === true}
            onQ={(q) => dispatch({ t: "q", q })}
            onLayer={(v) => dispatch({ t: "layer", v })}
            onClear={() => dispatch({ t: "clear" })}
            onRetry={() => dispatch({ t: "retry" })}
          />
        )}
        {look.screen === "detail" && (
          <DetailScreen
            s={s}
            mode={look.tabMode ?? "ready"}
            onTab={(v) => dispatch({ t: "tab", v })}
          />
        )}
        {look.screen === "metrics" && <MetricsScreen mode={look.metrics ?? "ready"} />}
        {look.screen === "proposals" && <ProposalsFilterEmpty onClear={() => {}} />}
      </Shell>
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}
