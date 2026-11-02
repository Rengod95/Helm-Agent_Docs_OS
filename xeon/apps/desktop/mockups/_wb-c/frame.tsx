// 묶음 C 크래프트 화면 틀: 공용 셸(크래프트 영역) + 오른쪽 탭 + 상태 표시줄. 페이지는 가운데 내용만 준다.
// - 내비를 누르면 같은 빌드 루트의 옆 시안 폴더로 옮긴다(목업 전용, ../<폴더>/index.html). 없는 화면은 그대로 둔다.
// - 개발 모드 칸(N-30 "배지 자리"): 개발 모드가 켜져 있으면 상태 표시줄 왼쪽 묶음 끝에 "개발 모드" 칸 하나. 꺼져 있으면 칸이 없다(DP-27).
import type { ReactNode } from "react";
import {
  defaultStatusCells,
  inbox,
  navigateToPage,
  NoticeList,
  Shell,
  T,
  Terminal,
  useShell,
  workbenchNav,
  workbenchRightTabs,
  type StatusCell,
} from "../_shell";

/** 크래프트 내비 id → 묶음 C 시안 폴더(목업 전용 이동). */
const NAV_FOLDER: Record<string, string> = {
  tests: "c01-trials",
  extensions: "c03-ext-list",
};

/** 옆 시안 폴더로 옮긴다. theme·lang·type·chrome·dev 쿼리는 _shell의 navigateToPage(라우팅 한 곳)가 이어 준다. */
export function goFolder(folder: string, query = ""): void {
  navigateToPage(folder, query);
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
      title: T.devMode,
      // 정상 상태 설명은 줄인다: 이 컴퓨터면 저장소 경로 한 줄, 원격이면 컴퓨터 이름 한 줄.
      description:
        d.remote !== undefined
          ? `원격 컴퓨터 ${d.remote}`
          : `${T.repoPath} ${d.repo ?? "~/code/fresnel"}`,
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
