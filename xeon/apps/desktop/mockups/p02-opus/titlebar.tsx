// 제목 띠 내용(AppShellTitlebar 안에 둔다. AppShell은 직계 자식 타입으로 제목 띠를 찾으므로 감싸지 않는다): 사이드바 토글, 경로(Breadcrumb), 명령 팔레트 버튼, 받은 요청(개수), 설정.
import {
  Breadcrumb,
  BreadcrumbCurrent,
  BreadcrumbItem,
  Button,
  IconButton,
  Kbd,
} from "@caustic/react";
import { Inbox, Monitor, PanelLeft, Search, Settings } from "./icons";
import { CountIconButton } from "./parts/count-icon-button";
import { useMock } from "./store";

export function Titlebar({ startId, endId }: { startId: string; endId: string }) {
  const m = useMock();
  const inboxCount = m.pendingApprovals + 3;
  const noop = (e: React.MouseEvent) => e.preventDefault();
  return (
    <>
      <IconButton
        size="sm"
        variant="ghost"
        label={m.startOpen ? "사이드바 닫기 (⌘\\)" : "사이드바 열기 (⌘\\)"}
        aria-expanded={m.startOpen}
        aria-controls={startId}
        onClick={() => m.setStartOpen(!m.startOpen)}
      >
        <PanelLeft />
      </IconButton>
      <Breadcrumb aria-label="현재 위치" className="min-w-0 flex-1 overflow-hidden">
        <BreadcrumbItem href="#" icon={<Monitor />} onClick={noop}>
          로컬
        </BreadcrumbItem>
        {m.layout !== "compact" && (
          <BreadcrumbItem href="#" onClick={noop} className="font-mono">
            ~/code/xeon
          </BreadcrumbItem>
        )}
        {m.view !== "none" && <BreadcrumbCurrent>{m.currentTitle}</BreadcrumbCurrent>}
      </Breadcrumb>
      <Button
        size="sm"
        tone="neutral"
        variant="outline"
        iconStart={<Search />}
        onClick={() => m.setPaletteOpen(true)}
        aria-keyshortcuts="Meta+K"
        aria-label="명령 또는 대화 찾기 (⌘K)"
        className="w-[min(18rem,32vw)] justify-start text-text-tertiary max-[720px]:w-auto"
      >
        <span className="flex-1 truncate text-left max-[720px]:hidden">명령 또는 대화 찾기</span>
        <Kbd size="xs" className="max-[720px]:hidden">
          ⌘K
        </Kbd>
      </Button>
      <CountIconButton
        size="sm"
        variant="ghost"
        count={inboxCount}
        label={`받은 요청 ${inboxCount}개 (⌘J)`}
        aria-expanded={m.endOpen}
        aria-controls={endId}
        onClick={() =>
          m.endOpen && m.endTab === "inbox" ? m.setEndOpen(false) : m.openEnd("inbox")
        }
      >
        <Inbox />
      </CountIconButton>
      <IconButton size="sm" variant="ghost" label="설정 (⌘,)">
        <Settings />
      </IconButton>
    </>
  );
}
