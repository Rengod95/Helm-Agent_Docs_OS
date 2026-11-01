// 묶음 C 작업대 화면 틀: 공용 셸(작업대 영역) + 오른쪽 탭 + 상태 표시줄. 페이지는 가운데 내용만 준다.
// - 내비를 누르면 같은 빌드 루트의 옆 시안 폴더로 옮긴다(목업 전용, ../<폴더>/index.html). 없는 화면은 그대로 둔다.
// - 개발 모드 칸(N-30 "배지 자리"): 개발 모드가 켜져 있으면 상태 표시줄 왼쪽 묶음 끝에 "개발 모드" 칸 하나. 꺼져 있으면 칸이 없다(DP-27).
import type { ReactNode } from "react";
import {
  defaultStatusCells,
  inbox,
  NoticeList,
  Shell,
  T,
  Terminal,
  useShell,
  workbenchNav,
  workbenchRightTabs,
  type StatusCell,
} from "../_shell";

/** 작업대 내비 id → 묶음 C 시안 폴더(목업 전용 이동). */
const NAV_FOLDER: Record<string, string> = {
  tests: "c01-trials",
  extensions: "c03-ext-list",
};

export function goFolder(folder: string, query = ""): void {
  const q = new URLSearchParams(window.location.search);
  const theme = q.get("theme") === "dark" ? "theme=dark" : "";
  const dev = q.get("dev") === "1" ? "dev=1" : "";
  const all = [query, theme, dev].filter((x) => x !== "").join("&");
  window.location.href = `../${folder}/index.html${all === "" ? "" : `?${all}`}`;
}

export interface DevModeInfo {
  on: boolean;
  /** 저장소 경로(개발 모드가 켜졌을 때) */
  repo?: string;
  /** 원격 호스트의 개발 모드를 따르는가(웹) */
  remote?: string;
  onOff?: () => void;
}

export function devModeCell(d: DevModeInfo): StatusCell[] {
  if (!d.on) return [];
  return [
    {
      id: "devmode",
      text: T.devMode,
      icon: <Terminal />,
      title: d.remote !== undefined ? `${d.remote}의 ${T.devMode}` : T.devMode,
      description:
        d.remote !== undefined
          ? `원격 컴퓨터 ${d.remote}가 ${T.devMode}라 ${T.replay}·${T.bench}·${T.coreDiff}를 돌릴 수 있어요. 바꾸려면 그 컴퓨터의 설정에서 바꿔요.`
          : `${T.repoPath} ${d.repo ?? "~/code/xeon"} · ${T.replay}·${T.bench}·${T.coreDiff}를 돌릴 수 있어요.`,
      ...(d.onOff !== undefined && d.remote === undefined
        ? { action: { label: `${T.devMode} 끄기`, onSelect: d.onOff } }
        : {}),
    },
  ];
}

export function WbFrame({
  active,
  stageLabel,
  devMode = { on: false },
  modalOpen = false,
  extFailures = 1,
  wbNav,
  children,
}: {
  active: string;
  stageLabel: string;
  devMode?: DevModeInfo;
  modalOpen?: boolean;
  extFailures?: number;
  wbNav?: typeof workbenchNav;
  children: ReactNode;
}) {
  const shell = useShell();
  const cells = defaultStatusCells({
    layout: shell.layout,
    thread: shell.context.kind !== "all",
    pendingApprovals: 2,
    openEnd: shell.openEnd,
    runtime: { drive: "helm", extFailures, onOpen: () => goFolder("c03-ext-list") },
  });
  const status =
    shell.layout === "compact"
      ? cells
      : { ...cells, start: [...cells.start, ...devModeCell(devMode)] };
  return (
    <Shell
      activeNav={active}
      onNavSelect={(id) => {
        const f = NAV_FOLDER[id];
        if (f !== undefined && id !== active) goFolder(f);
      }}
      stageLabel={stageLabel}
      modalOpen={modalOpen}
      threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
      workbench={{
        ...(wbNav !== undefined ? { nav: wbNav } : {}),
        onGoToThread: () => {},
      }}
      rightTabs={workbenchRightTabs({
        inbox: <NoticeList notices={inbox.notices} />,
        inboxBadge: 3,
        onGoToThread: () => {},
      })}
      status={status}
    >
      {children}
    </Shell>
  );
}
