// 대화를 고르지 않은 P-02 화면(공용 셸 + 빈 가운데). O-07·O-09·S-04처럼 어디서나 뜨는 층을 그 위에 보이는 바탕이다.
// O-09·S-04 목업도 이 파일을 가져온다(그 폴더 mockup.css가 이 폴더를 @source로 읽는다).
import { EmptyState, IconButton } from "@caustic/react";
import { useEffect, type ReactNode } from "react";
import {
  defaultStatusCells,
  PanelLeft,
  Shell,
  SquarePen,
  standardRightTabs,
  useShell,
  NoticeList,
  inbox,
  type PaletteGroup,
} from "../_shell";

export function QuietPage({
  onNew,
  modalOpen = false,
  palette,
  onPaletteRun,
  closeEnd = false,
  children,
}: {
  /** 오른쪽 well을 닫고 시작한다(막대만 남는다). */
  closeEnd?: boolean;
  onNew: () => void;
  modalOpen?: boolean;
  palette?: PaletteGroup[];
  onPaletteRun?: (group: string, label: string) => void;
  children?: ReactNode;
}) {
  const shell = useShell();
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만
  useEffect(() => {
    if (closeEnd) shell.setEndOpen(false);
  }, []);
  return (
    <Shell
      activeNav="chat"
      stageLabel="대화"
      modalOpen={modalOpen}
      threads={{ currentId: null, onSelect: () => {}, onNew }}
      rightTabs={standardRightTabs({
        only: ["inbox"],
        inboxBadge: 5,
        inbox: <NoticeList notices={inbox.notices} />,
      })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 2,
        openEnd: shell.openEnd,
      })}
      {...(palette !== undefined ? { palette } : {})}
      {...(onPaletteRun !== undefined ? { onPaletteRun } : {})}
    >
      <div className="flex h-10 flex-none items-center px-3">
        {!shell.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 열기"
            aria-expanded={false}
            onClick={() => shell.setStartOpen(true)}
            className="-ms-1.5"
          >
            <PanelLeft />
          </IconButton>
        )}
      </div>
      <div className="grid flex-1 place-items-center pb-10">
        <EmptyState
          size="sm"
          surface="none"
          icon={<SquarePen />}
          title="왼쪽에서 대화를 고르거나 새로 만드세요"
          actions={[{ label: "새 대화", onClick: onNew }]}
        />
      </div>
      {children}
    </Shell>
  );
}
