// P-07 예약 목업 진입점(무대 전체 화면). O-08 예약 편집 시트는 이 화면의 상태(S2~S8)다.
// ?state=S1..S11(기본 S1 목록), ?theme=dark. d03(묶음 D)가 D- 상태(오프라인, 실행 기록, 다시 켜기, 고치기, O-06 예약 삭제)를 더했다.
import { ShellStateProvider } from "../../_shell";
import {
  Alert,
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  SegmentedControl,
  Sheet,
  SegmentedControlItem,
  Skeleton,
  Table,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  BAR_INSET,
  Ellipsis,
  PanelLeft,
  defaultStatusCells,
  Shell,
  standardRightTabs,
  useShell,
} from "../../_shell";
import { schedules, type Schedule } from "./fixtures";
import { InboxLite } from "./parts/inbox-lite";
import { ScheduleSheet, type SheetMode } from "./schedule-sheet";
import { DeleteScheduleDialog } from "../../d01-chat-gaps/parts/dialogs";

type S =
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7"
  | "S8"
  | "S9"
  | "S10"
  | "S11"
  | "D-offline"
  | "D-runs"
  | "D-reenable"
  | "D-edit"
  | "D-delete";
export const STATES = [
  { id: "S1", label: "S1 목록" },
  { id: "S2", label: "S2 새 예약: 간격" },
  { id: "S3", label: "S3 새 예약: 시각" },
  { id: "S4", label: "S4 새 예약: 파일 감시" },
  { id: "S5", label: "S5 새 예약: 루프" },
  { id: "S6", label: "S6 새 예약: 원격" },
  { id: "S7", label: "S7 저장 오류" },
  { id: "S8", label: "S8 서비스 켜는 중" },
  { id: "S9", label: "S9 빈" },
  { id: "S10", label: "S10 읽는 중" },
  { id: "S11", label: "S11 목록 읽기 실패" },
  { id: "D-offline", label: "D 오프라인(목록 유지, 동작 잠금)" },
  { id: "D-runs", label: "D 실행 기록(schedule.runs)" },
  { id: "D-reenable", label: "D 꺼진 예약 다시 켜기" },
  { id: "D-edit", label: "D 고치기(schedule.update)" },
  { id: "D-delete", label: "D O-06 예약 삭제" },
] as const satisfies readonly { id: S; label: string }[];

const SHEET: Partial<Record<S, SheetMode>> = {
  S2: { trigger: "interval" },
  S3: { trigger: "at" },
  S4: { trigger: "fileWatch" },
  S5: { trigger: "loop" },
  S6: { trigger: "remote" },
  S7: { trigger: "interval", error: "interval_too_short" },
  S8: { trigger: "interval", saving: true },
  "D-edit": { trigger: "interval", edit: true },
};

const columns: TableColumn[] = [
  { key: "title", header: "예약" },
  { key: "trigger", header: "트리거", width: 150 },
  { key: "next", header: "다음 실행", width: 130 },
  { key: "last", header: "마지막 실행", width: 190 },
];

function LastRun({ s }: { s: Schedule }) {
  const l = s.last;
  if (l.status === "none") return <span className="text-text-tertiary">아직 없어요</span>;
  const word = { failed: "실패", completed: "완료", running: "진행 중", cancelled: "취소됨" }[
    l.status
  ];
  const tone = {
    failed: "text-danger-text",
    completed: "text-text-secondary",
    running: "text-text-primary",
    cancelled: "text-text-tertiary",
  }[l.status];
  return (
    <button
      type="button"
      title="이 실행이 만든 대화 열기"
      className="-mx-1 inline-flex min-w-0 items-baseline gap-1.5 rounded-sm px-1 text-left font-normal outline-none hover:underline focus-visible:focus-ring"
    >
      <span className={tone}>{word}</span>
      <span className="text-ui-xs text-text-tertiary">{l.at}</span>
    </button>
  );
}

function renderCell(row: TableRow, col: TableColumn): ReactNode {
  const s = row["s"] as Schedule;
  const dim = s.enabled ? "" : "opacity-60";
  switch (col.key) {
    case "title":
      return <span className={`truncate font-medium text-text-primary ${dim}`}>{s.title}</span>;
    case "trigger":
      return <span className={`font-normal text-text-secondary ${dim}`}>{s.triggerText}</span>;
    case "next":
      return (
        <span className={`font-normal tabular-nums text-text-secondary ${dim}`}>{s.next}</span>
      );
    case "last":
      return <LastRun s={s} />;
  }
  return null;
}

function rowActionsFor(o: {
  offline: boolean;
  onRuns: () => void;
  onEdit: () => void;
  onDelete: () => void;
  reenabled: boolean;
  onReenable: () => void;
}) {
  return function rowActions(row: TableRow) {
    const s = row["s"] as Schedule;
    const off = !s.enabled && !(s.id === "s6" && o.reenabled);
    return (
      <div className="flex items-center justify-end gap-0.5">
        {off && (
          <Button
            size="xs"
            tone="neutral"
            variant="outline"
            disabled={o.offline}
            onClick={o.onReenable}
          >
            다시 켜기
          </Button>
        )}
        {s.trigger === "remote" && s.enabled && (
          <Button size="xs" tone="neutral" variant="ghost" disabled={o.offline}>
            지금 실행
          </Button>
        )}
        <Menu
          align="end"
          aria-label={`${s.title} 메뉴`}
          trigger={
            <IconButton size="xs" variant="ghost" label={`${s.title} 메뉴`}>
              <Ellipsis />
            </IconButton>
          }
        >
          <MenuItem disabled={s.last.status === "none"}>마지막 실행 대화 열기</MenuItem>
          <MenuItem onSelect={o.onRuns}>실행 기록</MenuItem>
          <MenuItem disabled={o.offline} onSelect={o.onEdit}>
            고치기…
          </MenuItem>
          <MenuItem disabled={s.trigger !== "remote" || o.offline}>지금 실행</MenuItem>
          <MenuItem disabled={o.offline}>복제</MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!s.enabled || o.offline}>끄기</MenuItem>
          <MenuItem tone="danger" disabled={o.offline} onSelect={o.onDelete}>
            지우기…
          </MenuItem>
        </Menu>
      </div>
    );
  };
}

/** d03: 실행 기록(schedule.runs, W-07). 오른쪽 Sheet, 행을 누르면 그 실행이 만든 대화. */
function RunsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const runs = [
    {
      at: "오늘 09:00",
      status: "실패",
      reason: "",
      thread: "예약: 매일 정리",
    },
    {
      at: "어제 09:00",
      status: "완료",
      reason: "",
      thread: "예약: 매일 정리 (10/31)",
    },
    {
      at: "10월 30일 09:00",
      status: "완료",
      reason: "",
      thread: "예약: 매일 정리 (10/30)",
    },
    {
      at: "10월 29일 09:00",
      status: "건너뜀",
      reason: "앱 꺼짐 · 서비스 모드 꺼짐",
      thread: "",
    },
    {
      at: "10월 28일 09:00",
      status: "완료",
      reason: "",
      thread: "예약: 매일 정리 (10/28)",
    },
  ];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="실행 기록 · 매일 정리"
      closeLabel="닫기"
      size="sm"
    >
      <div className="grid gap-1">
        {runs.map((r) => (
          <div
            key={r.at}
            role={r.thread === "" ? undefined : "button"}
            tabIndex={r.thread === "" ? undefined : 0}
            className="-mx-2 grid gap-0.5 rounded-md px-2 py-1.5 text-start outline-none hover:bg-fill-hover focus-visible:focus-ring"
          >
            <span className="flex items-baseline gap-2 text-ui-sm">
              <span
                className={
                  r.status === "실패"
                    ? "text-danger-text"
                    : r.status === "건너뜀"
                      ? "text-text-tertiary"
                      : "text-text-primary"
                }
              >
                {r.status}
              </span>
              <span className="tabular-nums text-text-secondary">{r.at}</span>
            </span>
            <span className="truncate text-ui-xs text-text-tertiary">
              {r.reason !== "" ? <span className="font-mono">{r.reason}</span> : null}
              {r.reason !== "" && r.thread !== "" ? " · " : ""}
              {r.thread}
            </span>
          </div>
        ))}
        <Button size="xs" tone="neutral" variant="ghost" className="justify-self-start">
          더 보기
        </Button>
      </div>
    </Sheet>
  );
}

function Page({ state }: { state: S }) {
  const shell = useShell();
  const mode = SHEET[state];
  const [sheetOpen, setSheetOpen] = useState(mode !== undefined);
  const offline = state === "D-offline";
  const [runsOpen, setRunsOpen] = useState(state === "D-runs");
  const [del, setDel] = useState(state === "D-delete");
  const [reenabled, setReenabled] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const rowActions = rowActionsFor({
    offline,
    reenabled,
    onRuns: () => setRunsOpen(true),
    onEdit: () => setEditOpen(true),
    onDelete: () => setDel(true),
    onReenable: () => setReenabled(true),
  });
  const [filter, setFilter] = useState("all");
  // 전체 화면 표라 오른쪽 well은 막대로 접어 둔다(받은 요청은 막대에서 연다).
  useEffect(() => {
    shell.setEndOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const list = (state === "S9" ? [] : schedules)
    .map((s) => (s.id === "s6" && reenabled ? { ...s, enabled: true, next: "11월 3일 09:00" } : s))
    .filter((s) => filter === "all" || s.enabled);
  const rows: TableRow[] = list.map((s) => ({ id: s.id, s }));
  return (
    <>
      <Shell
        activeNav="schedules"
        stageLabel="예약"
        modalOpen={sheetOpen}
        threads={{ currentId: null, onSelect: () => {}, onNew: () => setSheetOpen(true) }}
        rightTabs={standardRightTabs({ inbox: <InboxLite />, inboxBadge: 5, only: ["inbox"] })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: false,
          pendingApprovals: 2,
          openEnd: shell.openEnd,
          ...(offline
            ? {
                link: {
                  id: "link",
                  text: "끊김",
                  dot: "danger" as const,
                  title: "연결 끊김",
                  description: "엔진에 연결되지 않았어요.",
                },
              }
            : {}),
        })}
      >
        <header className={`flex h-10 flex-none items-center gap-2 ps-3 ${BAR_INSET}`}>
          {!shell.startOpen && (
            <IconButton
              size="sm"
              variant="ghost"
              label="사이드바 열기"
              onClick={() => shell.setStartOpen(true)}
              className="-ms-1.5"
            >
              <PanelLeft />
            </IconButton>
          )}
          <h1 className="m-0 flex min-w-0 flex-1 items-baseline gap-2 text-ui-strong text-text-primary">
            예약
          </h1>
          <SegmentedControl size="xs" aria-label="보기" value={filter} onValueChange={setFilter}>
            <SegmentedControlItem value="enabled">켜진 것</SegmentedControlItem>
            <SegmentedControlItem value="all">모두</SegmentedControlItem>
          </SegmentedControl>
          <Button
            size="sm"
            tone="neutral"
            variant="solid"
            disabled={offline}
            onClick={() => setSheetOpen(true)}
          >
            새 예약
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          <div className="grid gap-2">
            {offline && (
              <Alert tone="neutral" size="sm">
                엔진에 연결되지 않아 예약을 바꿀 수 없어요. 목록은 마지막으로 읽은 14:02 그대로예요.
              </Alert>
            )}
            {state !== "S9" && !offline && (
              <Alert
                tone="warning"
                size="sm"
                action={
                  <Button size="xs" tone="neutral" variant="ghost">
                    서비스 켜기
                  </Button>
                }
              >
                서비스 모드가 꺼져 있어 앱을 닫으면 예약이 멈춰요.
              </Alert>
            )}
            {state === "S11" && (
              <Alert
                tone="danger"
                size="sm"
                action={
                  <Button size="xs" tone="neutral" variant="ghost">
                    다시 읽기
                  </Button>
                }
              >
                예약 목록을 읽지 못했어요.
              </Alert>
            )}
            {state === "S10" ? (
              <div className="grid gap-3 pt-2" aria-busy>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="flex gap-6">
                    <Skeleton width="30%" height={12} />
                    <Skeleton width="15%" height={12} />
                    <Skeleton width="12%" height={12} />
                    <Skeleton width="18%" height={12} />
                  </div>
                ))}
              </div>
            ) : state === "S11" ? null : rows.length === 0 ? (
              <EmptyState
                size="sm"
                surface="none"
                title="예약이 없어요"
                actions={
                  <Button
                    size="sm"
                    tone="neutral"
                    variant="solid"
                    onClick={() => setSheetOpen(true)}
                  >
                    새 예약
                  </Button>
                }
                className="pt-16"
              />
            ) : (
              <Table
                aria-label="예약 목록"
                size="sm"
                variant="ghost"
                columns={columns}
                rows={rows}
                renderCell={renderCell}
                rowActions={rowActions}
                rowLabel={(r) => (r["s"] as Schedule).title}
              />
            )}
          </div>
        </div>
      </Shell>
      {mode !== undefined && (
        <ScheduleSheet mode={mode} open={sheetOpen} onOpenChange={setSheetOpen} />
      )}
      <RunsSheet open={runsOpen} onOpenChange={setRunsOpen} />
      {editOpen && (
        <ScheduleSheet
          mode={{ trigger: "interval", edit: true }}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      {del && (
        <DeleteScheduleDialog onClose={() => setDel(false)} onConfirm={() => setDel(false)} />
      )}
      {mode === undefined && sheetOpen && (
        <ScheduleSheet
          mode={{ trigger: "interval" }}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      )}
    </>
  );
}

export function Root({ state }: { state: string }) {
  return (
    <ShellStateProvider>
      <Page state={state as S} />
    </ShellStateProvider>
  );
}
