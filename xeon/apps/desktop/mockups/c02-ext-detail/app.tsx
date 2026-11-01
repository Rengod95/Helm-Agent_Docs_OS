// P-17 확장 상세: 버전 탭 두 단계(N-31)와 O-11 되돌리기(결정 6), 설정 탭 값 출처·저장 위치(N-32)와 settings slot(N-25),
// 화면 탭(N-33), 기록 탭 진단 위치(N-34), X 훅 상세(N-36, 결정 12). 탭은 caustic Tabs(soft xs), 720 아래는 Select 하나(DP-37).
// 확장 머리: 표시 이름 + 회색 mono id(결정 13), 층 mono, 종류·등급·버전, 상태 점.
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  Select,
  SelectOption,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  toast,
} from "@caustic/react";
import { useEffect, useRef } from "react";
import {
  Copy,
  Ellipsis,
  extName,
  FlaskConical,
  FolderOpen,
  RotateCw,
  ScenarioDock,
  T,
  useShell,
  WB_WIDTH,
  WorkbenchHead,
  josa,
} from "../_shell";
import { useMachine, usePrefill } from "../_chat-rt";
import { goFolder, WbFrame } from "../_wb-c/frame";
import { DotText, LayerCell } from "../_wb-c/parts";
import { effect, init, reduce, SCRIPTS, type A, type S, type Tab } from "./flow";
import { HooksTab, LogTab, OverviewTab, SettingsTab, ViewsTab } from "./parts/tabs";
import { RevertDialog, VersionsFallback, VersionsFull } from "./parts/versions";

export const STATES = [
  { id: "versions", label: `${T.version}: 전체(설치 이력)` },
  { id: "versions-builtin", label: `${T.version}: 대체 · 기본 플러그인` },
  { id: "versions-user", label: `${T.version}: 대체 · 사용자 확장(폴더 열기)` },
  { id: "versions-web", label: `${T.version}: 웹 · 경로 복사` },
  { id: "revert-confirm", label: "O-11 되돌리기 확인" },
  { id: "revert-nomig", label: "O-11 형식 변환 없음(비우고 되돌리기)" },
  { id: "revert-progress", label: "되돌리는 중" },
  { id: "revert-done", label: "되돌림 끝" },
  { id: "revert-failed", label: "실패: 형식 변환 실패 → 원복" },
  { id: "settings", label: "설정: 값 출처 + 플러그인 부분" },
  { id: "settings-profile", label: "설정: 보기 기준 프로필(저장 위치)" },
  { id: "settings-trial", label: "설정: 보기 기준 시험(저장 위치)" },
  { id: "views", label: "화면: 방식·실패 기록·진단" },
  { id: "log", label: "기록: 진단 위치(파일 열기)" },
  { id: "log-web", label: "기록: 웹(경로 복사)" },
  { id: "hook", label: "X 훅 상세" },
  { id: "hook-safe", label: "X 훅: 안전 모드에서 빠짐" },
  { id: "narrow", label: "좁은 폭(390): 탭이 Select" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, { script: string; n: number; ext: string; tab: Tab }> = {
  versions: { script: "base", n: 0, ext: "helm", tab: "versions" },
  "versions-builtin": { script: "base", n: 0, ext: "learning", tab: "versions" },
  "versions-user": { script: "base", n: 0, ext: "acme-notes", tab: "versions" },
  "versions-web": { script: "base", n: 0, ext: "acme-notes", tab: "versions" },
  "revert-confirm": { script: "revert", n: 1, ext: "helm", tab: "versions" },
  "revert-nomig": { script: "revert-no-migration", n: 1, ext: "helm", tab: "versions" },
  "revert-progress": { script: "revert", n: 4, ext: "helm", tab: "versions" },
  "revert-done": { script: "revert", n: 6, ext: "helm", tab: "versions" },
  "revert-failed": { script: "revert-fail", n: 6, ext: "helm", tab: "versions" },
  settings: { script: "base", n: 0, ext: "helm", tab: "settings" },
  "settings-profile": { script: "base", n: 0, ext: "helm", tab: "settings" },
  "settings-trial": { script: "base", n: 0, ext: "helm", tab: "settings" },
  views: { script: "base", n: 0, ext: "helm", tab: "views" },
  log: { script: "base", n: 0, ext: "acme-notes", tab: "log" },
  "log-web": { script: "base", n: 0, ext: "acme-notes", tab: "log" },
  hook: { script: "base", n: 0, ext: "audit-log", tab: "hooks" },
  "hook-safe": { script: "base", n: 0, ext: "audit-log", tab: "hooks" },
  narrow: { script: "base", n: 0, ext: "helm", tab: "versions" },
};

export const SCENARIOS = [
  { id: "revert", label: "되돌리기: 확인 → 진행 → 끝" },
  { id: "revert-fail", label: "실패: 형식 변환 실패 → 원복" },
  { id: "revert-no-migration", label: "형식 변환 없음: 비우고 되돌리기" },
  { id: "views-reenable", label: "화면 다시 켜기" },
];

interface Meta {
  layer: string;
  kind: string;
  trust: string;
  version: string;
  status: { tone: "success" | "warning" | "neutral"; text: string };
  tabs: Tab[];
}
const META: Record<string, Meta> = {
  helm: {
    layer: "L3",
    kind: T.group,
    trust: T.trustUser,
    version: "0.1.0",
    status: { tone: "success", text: `켜짐 · ${T.lead} 보유` },
    tabs: ["overview", "points", "lease", "settings", "metrics", "log", "versions", "views"],
  },
  learning: {
    layer: "L3",
    kind: T.group,
    trust: T.trustBuiltin,
    version: "0.4.1",
    status: { tone: "success", text: "켜짐" },
    tabs: ["overview", "points", "settings", "metrics", "log", "versions", "views"],
  },
  "acme-notes": {
    layer: "plugin",
    kind: T.plugin,
    trust: T.trustProject,
    version: "0.0.9",
    status: { tone: "warning", text: "켜짐 · 실패 2" },
    tabs: ["overview", "points", "settings", "log", "versions"],
  },
  "audit-log": {
    layer: "X",
    kind: `X ${T.hook}`,
    trust: T.trustProject,
    version: "-",
    status: { tone: "warning", text: "켜짐 · 실패 3" },
    tabs: ["overview", "hooks", "log"],
  },
};
const TAB_LABEL: Record<Tab, string> = {
  overview: T.overview,
  points: T.extensionPoint,
  lease: `${josa(T.lead, "과", "와")} 상한`,
  settings: "설정",
  metrics: T.metrics,
  log: "기록",
  versions: T.version,
  views: "화면",
  hooks: T.hook,
};

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const at = AT[state];
  const pre = usePrefill(SCRIPTS, at);
  const [s0, dispatch] = useMachine<S, A>({
    init: init(pre.script, at.ext, at.tab),
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const web = state === "versions-web" || state === "log-web";
  const safe = state === "hook-safe";
  const s: S = { ...s0, web, safe };
  const meta = META[s.ext] ?? META["helm"];
  const compact = shell.layout === "compact";

  const seen = useRef<number | null>(pre.live ? null : (s.note?.id ?? null));
  useEffect(() => {
    if (s.note === null || s.note.id === seen.current) return;
    seen.current = s.note.id;
    toast({
      title: s.note.title,
      ...(s.note.body !== undefined ? { description: s.note.body } : {}),
      tone: s.note.tone ?? "neutral",
    });
  }, [s.note]);

  useEffect(() => {
    shell.setEndOpen(false);
    if (state === "narrow") shell.setStartOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (meta === undefined) return null;
  const cur = s.history.find((v) => v.current === true)?.version ?? "0.1.0";
  const busy = s.revert !== "closed" && s.revert !== "confirm";

  const hint = (() => {
    if (!pre.live) return undefined;
    if (pre.script.startsWith("revert")) {
      if (s.revert === "closed" && s.result === null)
        return `이력에서 "${T.revert}" 단추를 누르세요`;
      if (s.revert === "confirm")
        return `"${pre.script === "revert-no-migration" ? T.clearAndRevert : T.revert}" 단추를 누르세요`;
      if (busy) return "진행을 지켜보세요";
      return "끝났어요";
    }
    if (pre.script === "views-reenable")
      return s.reenabled ? "끝났어요" : `"${T.viewReenable}" 단추를 누르세요`;
    return undefined;
  })();

  const body = (tab: Tab) => {
    switch (tab) {
      case "versions":
        return s.ext === "helm" ? (
          <VersionsFull
            history={s.history}
            result={s.result}
            compact={compact}
            onAsk={(version) => dispatch({ t: "ask", version })}
          />
        ) : (
          <VersionsFallback ext={s.ext === "learning" ? "learning" : "acme-notes"} web={s.web} />
        );
      case "settings":
        return <SettingsTab />;
      case "views":
        return (
          <ViewsTab reenabled={s.reenabled} onReenable={() => dispatch({ t: "reenableView" })} />
        );
      case "log":
        return <LogTab web={s.web} />;
      case "hooks":
        return <HooksTab safe={s.safe} />;
      default:
        return <OverviewTab ext={s.ext} />;
    }
  };

  return (
    <>
      <WbFrame
        active="extensions"
        stageLabel={`${T.extension} ${extName(s.ext)}`}
        modalOpen={s.revert !== "closed"}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkbenchHead
            title={
              <span className="inline-flex items-baseline gap-1.5">
                {extName(s.ext)}
                <span className="font-mono text-mono-sm font-normal text-text-tertiary max-compact:hidden">
                  {s.ext}
                </span>
              </span>
            }
            meta={
              <span className="inline-flex items-center gap-2">
                <LayerCell>{meta.layer}</LayerCell>
                <span className="max-compact:hidden">
                  {meta.kind} · {meta.trust} · {s.ext === "helm" ? cur : meta.version}
                </span>
                <span className="max-compact:hidden">
                  <DotText tone={safe ? "neutral" : meta.status.tone}>
                    {safe ? `${josa(T.safeMode, "이라", "라")} 빠짐` : meta.status.text}
                  </DotText>
                </span>
              </span>
            }
            actions={
              <>
                <Button size="xs" tone="neutral" variant="outline" disabled={busy || safe}>
                  끄기
                </Button>
                <Menu
                  align="end"
                  aria-label="확장 메뉴"
                  trigger={
                    <IconButton size="sm" variant="ghost" label="확장 메뉴">
                      <Ellipsis />
                    </IconButton>
                  }
                >
                  <MenuItem
                    icon={<FlaskConical />}
                    onSelect={() => goFolder("c01-trials", "state=new")}
                  >
                    시험 시작
                  </MenuItem>
                  <MenuItem icon={<RotateCw />}>다시 읽기</MenuItem>
                  {web ? (
                    <MenuItem icon={<Copy />}>경로 복사</MenuItem>
                  ) : (
                    <MenuItem icon={<FolderOpen />}>폴더 열기</MenuItem>
                  )}
                  <MenuItem icon={<Copy />}>확장 정보 파일 복사</MenuItem>
                </Menu>
              </>
            }
          />
          <Tabs
            value={s.tab}
            onValueChange={(v) => dispatch({ t: "tab", tab: v as Tab })}
            variant="soft"
            size="xs"
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className={`${WB_WIDTH} flex-none pb-2`}>
              {compact ? (
                <Select
                  size="xs"
                  aria-label="확장 상세 탭"
                  value={s.tab}
                  onValueChange={(v) => dispatch({ t: "tab", tab: v as Tab })}
                  className="w-48"
                >
                  {meta.tabs.map((t) => (
                    <SelectOption key={t} value={t}>
                      {TAB_LABEL[t]}
                    </SelectOption>
                  ))}
                </Select>
              ) : (
                <TabsList aria-label="확장 상세">
                  {meta.tabs.map((t) => (
                    <TabsTrigger
                      key={t}
                      value={t}
                      {...(t === "views" && s.ext === "helm" && !s.reenabled ? { count: 2 } : {})}
                      {...(t === "log" && s.ext === "acme-notes" ? { count: 3 } : {})}
                    >
                      {TAB_LABEL[t]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className={`${WB_WIDTH} pt-1 pb-8`}>
                {meta.tabs.map((t) => (
                  <TabsContent key={t} value={t}>
                    {t === s.tab ? body(t) : null}
                  </TabsContent>
                ))}
              </div>
            </div>
          </Tabs>
        </div>
      </WbFrame>
      <RevertDialog
        ext={s.ext}
        from={s.result === "failed" ? cur : "0.1.0"}
        to={s.target}
        step={s.revert}
        mode={s.mode}
        onCancel={() => dispatch({ t: "cancel" })}
        onGo={(mode) => dispatch(mode !== undefined ? { t: "go", mode } : { t: "go" })}
      />
      <Toaster label="알림" />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}
