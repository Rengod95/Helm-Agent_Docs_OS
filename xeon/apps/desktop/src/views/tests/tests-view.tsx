// 테스트 화면(P-19)의 그림. 상태와 명령은 없고 props와 핸들러만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 시안(c01-trials app.tsx): 머리(제목 + 새 시험), "시험 대화" 구역, "재실행 검사 · 성능 측정 · 보호 경로 검사" 구역(개발 모드가 아니면
// "개발 모드에서만" 잠금 배지). 고른 행의 상세는 그 행이 속한 구역 바로 아래에 펼친다. 좁은 폭(`compact`)은 표 대신 두 줄 목록이다.
// 목록 상태(읽는 중, 오프라인, 오류, 빈 목록)를 먼저 가리고, 값이 있으면 caustic `Table`로 그린다.
import { t } from "@fresnel/client/i18n";
import {
  replayVerdictOf,
  type TabRead,
  type TestFilter,
  type TestKindFilter,
  type TestRowVM,
  type TestStatusFilter,
  type TestsUiState,
} from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Select,
  SelectOption,
  Skeleton,
  Table,
  type TableColumn,
} from "@caustic/react";
import { Lock } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { NewTestSheet, RunConfirmDialog, type NewTestHandlers } from "./new-test-sheet.tsx";
import { TestDetail, type TestDetailHandlers } from "./test-detail.tsx";
import {
  KIND_FILTER_TEXT,
  KIND_TEXT,
  NEW_KIND_TEXT,
  noticeArgsOf,
  noticeTextOf,
  STATE_TEXT,
  STATUS_FILTER_TEXT,
  timeTextOf,
} from "./tests-text.ts";

const MUTED = "m-0 text-ui-sm text-text-tertiary";
const KIND_FILTERS: readonly TestKindFilter[] = ["all", "replay", "testRun"];
const STATUS_FILTERS: readonly TestStatusFilter[] = ["all", "running", "passed", "failed"];

export interface TestsViewHandlers extends TestDetailHandlers {
  readonly select: (testId: string | null) => void;
  readonly filter: (filter: TestFilter) => void;
  readonly openSheet: () => void;
  readonly retry: () => void;
  readonly dismissNotice: () => void;
  readonly sheet: NewTestHandlers;
  readonly confirmRun: () => void;
  readonly cancelRun: () => void;
}

export interface TestsViewProps {
  /** 목록의 읽기 상태. 값이 있으면 전체 기록이다(거르기 전) */
  readonly read: TabRead<readonly ExtTestRecord[]>;
  /** 거른 뒤의 행 */
  readonly rows: readonly TestRowVM[];
  readonly selected: TestRowVM | null;
  readonly ui: TestsUiState;
  /** 엔진에 연결되어 있나. 아니면 "새 시험"이 잠긴다 */
  readonly online: boolean;
  /** 좁은 폭(720 아래)이면 표 대신 두 줄 목록을 그린다 */
  readonly compact?: boolean;
  readonly selectedPaused: boolean;
  readonly selectedPhase: string | null;
  /** 새 Test run의 대상으로 고를 수 있는 확장 이름 */
  readonly targetNames: readonly string[];
  readonly handlers: TestsViewHandlers;
}

export function TestsView(props: TestsViewProps): ReactNode {
  const { ui, handlers } = props;
  const ready = props.read.kind === "ready";
  return (
    <section
      aria-labelledby="tests-screen-title"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="mx-auto grid w-full max-w-240 gap-5 px-3 pt-4 pb-8">
        <header className="flex h-10 min-w-0 items-center gap-2 pe-8">
          <h1 id="tests-screen-title" className="m-0 min-w-0 truncate text-text-primary">
            {t("desktop.tests.title")}
          </h1>
          <Button
            className="ms-auto"
            size="xs"
            variant="outline"
            disabled={!props.online || ui.sending}
            onClick={handlers.openSheet}
          >
            {t("desktop.tests.newTest")}
          </Button>
        </header>
        {ui.notice === null ? null : (
          <Alert
            tone={
              ui.notice.kind === "failed" || ui.notice.kind === "copyFailed" ? "danger" : "success"
            }
            dismissible
            dismissLabel={t("desktop.tests.sheet.close")}
            onDismiss={handlers.dismissNotice}
          >
            {t(noticeTextOf(ui.notice), noticeArgsOf(ui.notice))}
          </Alert>
        )}
        {ready && props.read.value.length > 0 ? (
          <FilterRow filter={ui.filter} onChange={handlers.filter} />
        ) : null}
        <ListBody {...props} />
      </div>
      <NewTestSheet
        draft={ui.sheet}
        devMode={ui.devMode}
        sending={ui.sending}
        targetNames={props.targetNames}
        failure={ui.notice?.kind === "failed" ? t(noticeTextOf(ui.notice)) : null}
        handlers={handlers.sheet}
      />
      <RunConfirmDialog
        params={ui.confirm}
        onConfirm={handlers.confirmRun}
        onCancel={handlers.cancelRun}
      />
    </section>
  );
}

function FilterRow(props: {
  readonly filter: TestFilter;
  readonly onChange: (filter: TestFilter) => void;
}): ReactNode {
  const { filter, onChange } = props;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("desktop.tests.filter.kind")}>
        <Select
          size="xs"
          value={filter.kind}
          onValueChange={(value) => {
            const kind = KIND_FILTERS.find((item) => item === value);
            if (kind !== undefined) onChange({ ...filter, kind });
          }}
        >
          {KIND_FILTERS.map((kind) => (
            <SelectOption key={kind} value={kind}>
              {t(KIND_FILTER_TEXT[kind])}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <Field label={t("desktop.tests.filter.status")}>
        <Select
          size="xs"
          value={filter.status}
          onValueChange={(value) => {
            const status = STATUS_FILTERS.find((item) => item === value);
            if (status !== undefined) onChange({ ...filter, status });
          }}
        >
          {STATUS_FILTERS.map((status) => (
            <SelectOption key={status} value={status}>
              {t(STATUS_FILTER_TEXT[status])}
            </SelectOption>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** 목록 본문. 읽는 중, 오프라인, 오류, 빈 목록, 거른 결과 없음, 구역을 나눈다 */
function ListBody(props: TestsViewProps): ReactNode {
  const { read, rows, handlers, ui } = props;
  switch (read.kind) {
    case "loading":
      return (
        <div role="status" aria-busy="true" className="grid gap-2">
          <span className="sr-only">{t("desktop.tests.loading")}</span>
          {[0, 1, 2].map((line) => (
            <Skeleton key={line} height={36} />
          ))}
        </div>
      );
    case "offline":
      return <p className={MUTED}>{t("desktop.tests.offline")}</p>;
    case "error":
      return (
        <Alert
          tone="danger"
          action={
            <Button size="xs" variant="outline" onClick={handlers.retry}>
              {t("desktop.tests.retry")}
            </Button>
          }
        >
          {t("desktop.tests.loadFailed")}
        </Alert>
      );
    case "ready":
      return (
        <div className="grid gap-5">
          {read.stale ? <p className={MUTED}>{t("desktop.tests.stale")}</p> : null}
          {read.value.length === 0 ? (
            <EmptyState
              size="sm"
              title={t("desktop.tests.empty")}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.online || ui.sending}
                  onClick={handlers.openSheet}
                >
                  {t("desktop.tests.newTest")}
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <p role="status" className={MUTED}>
              {t("desktop.tests.emptyFiltered")}
            </p>
          ) : (
            <Sections {...props} rows={rows} />
          )}
        </div>
      );
    default:
      return assertNever(read, "TabRead");
  }
}

/** 두 구역: 시험 대화(Test run), 재실행 검사·성능 측정·보호 경로 검사. 구역에 행이 없으면 그 구역은 그리지 않는다 */
function Sections(props: TestsViewProps & { readonly rows: readonly TestRowVM[] }): ReactNode {
  const { rows, selected, ui, handlers, compact = false } = props;
  const trials = rows.filter((row) => row.kind === "testRun");
  const replays = rows.filter((row) => row.kind === "replay");
  const detail =
    selected === null ? null : (
      <TestDetail
        row={selected}
        paused={props.selectedPaused}
        phase={props.selectedPhase}
        handlers={handlers}
        devMode={ui.devMode}
      />
    );
  // 고른 행이 속한 구역이 그려질 때만 그 구역 아래에 상세를 둔다(거른 목록 밖이면 구역들 뒤)
  const inTrials = selected?.kind === "testRun" && trials.length > 0;
  const inReplays = selected?.kind === "replay" && replays.length > 0;
  const devTitle = [
    t(NEW_KIND_TEXT.replay),
    t(NEW_KIND_TEXT.benchmark),
    t(NEW_KIND_TEXT.coreDiff),
  ].join(" · ");
  return (
    <>
      {trials.length === 0 ? null : (
        <Group title={t("desktop.tests.section.trial")}>
          {compact ? (
            <RunList rows={trials} selected={selected} onSelect={handlers.select} />
          ) : (
            <TestTable
              rows={trials}
              selected={selected}
              onSelect={handlers.select}
              columns={trialColumns()}
            />
          )}
          {inTrials ? detail : null}
        </Group>
      )}
      {replays.length === 0 ? null : (
        <Group
          title={devTitle}
          end={
            <>
              {ui.devMode ? null : (
                <Badge size="xs" variant="soft" icon={<Lock />}>
                  {t("desktop.tests.lock.devMode")}
                </Badge>
              )}
              <InfoTip text={t("desktop.tests.excluded")} />
            </>
          }
        >
          {compact ? (
            <RunList rows={replays} selected={selected} onSelect={handlers.select} />
          ) : (
            <TestTable
              rows={replays}
              selected={selected}
              onSelect={handlers.select}
              columns={replayColumns()}
            />
          )}
          {inReplays ? detail : null}
        </Group>
      )}
      {selected !== null && !inTrials && !inReplays ? detail : null}
    </>
  );
}

/** 구역 머리(시안 SectionTitle): 굵기와 글자색 단계로만 묶고, 오른쪽 끝에 잠금 배지와 설명 아이콘을 둔다 */
function Group(props: {
  readonly title: string;
  readonly end?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="grid gap-2">
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        <h2 className="m-0 min-w-0 truncate text-text-primary">{props.title}</h2>
        {props.end === undefined ? null : (
          <span className="ms-auto flex items-center gap-1 text-ui-xs text-text-tertiary">
            {props.end}
          </span>
        )}
      </div>
      {props.children}
    </section>
  );
}

const TEST_COLUMNS = ["kind", "target", "result", "state", "time"] as const;
type TestColumnKey = (typeof TEST_COLUMNS)[number];

function testColumnOf(key: string): TestColumnKey | null {
  return TEST_COLUMNS.find((column) => column === key) ?? null;
}

/** 시험 대화 구역의 열: 대상, 상태, 시작 */
function trialColumns(): TableColumn[] {
  return [
    { key: "target", header: t("desktop.tests.col.target"), width: 144 },
    { key: "state", header: t("desktop.tests.col.state"), width: 192 },
    { key: "time", header: t("desktop.tests.col.started") },
  ];
}

/** 재실행 검사 구역의 열: 종류, 대상, 결과, 시각 */
function replayColumns(): TableColumn[] {
  return [
    { key: "kind", header: t("desktop.tests.col.kind"), width: 160 },
    { key: "target", header: t("desktop.tests.col.target"), width: 144 },
    { key: "result", header: t("desktop.tests.col.result") },
    { key: "time", header: t("desktop.tests.col.time") },
  ];
}

function TestTable(props: {
  readonly rows: readonly TestRowVM[];
  readonly selected: TestRowVM | null;
  readonly onSelect: (testId: string | null) => void;
  readonly columns: TableColumn[];
}): ReactNode {
  const { rows, selected, onSelect, columns } = props;
  const byId = new Map(rows.map((row) => [row.testId, row] as const));
  return (
    <Table
      size="xs"
      variant="ghost"
      dividers={false}
      columns={columns}
      rows={rows.map((row) => ({ id: row.testId }))}
      selectionMode="single"
      selectedKeys={selected === null ? [] : [selected.testId]}
      onRowActivate={(picked) => {
        onSelect(selected?.testId === picked.id ? null : picked.id);
      }}
      renderCell={(picked, column) => {
        const row = byId.get(picked.id);
        const name = testColumnOf(column.key);
        if (row === undefined || name === null) return null;
        return <TestCell row={row} column={name} />;
      }}
    />
  );
}

/** 좁은 폭의 두 줄 목록(시안 RunList). 고른 행은 raised 면 하나, 다시 누르면 놓는다 */
function RunList(props: {
  readonly rows: readonly TestRowVM[];
  readonly selected: TestRowVM | null;
  readonly onSelect: (testId: string | null) => void;
}): ReactNode {
  const { rows, selected, onSelect } = props;
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {rows.map((row) => {
        const on = selected?.testId === row.testId;
        return (
          <li key={row.testId}>
            <Button
              variant="ghost"
              size="sm"
              aria-current={on}
              onClick={() => {
                onSelect(on ? null : row.testId);
              }}
              className={`h-auto w-full justify-start gap-0.5 rounded-md px-2 py-1.5 text-start ${on ? "bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]" : ""}`}
            >
              <span className="grid w-full min-w-0 gap-0.5">
                <span className="flex min-w-0 items-center gap-2 text-ui-dense">
                  <span className="truncate text-text-primary">{row.target}</span>
                  <span className="ms-auto flex-none text-ui-xs text-text-tertiary">
                    {timeTextOf(row.startedMs)}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-2 text-ui-xs text-text-tertiary">
                  <TestStatus row={row} />
                </span>
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** 상태 점과 글 한 쌍(시안 DotText). 색은 상태 점에만 둔다 */
type Dot = "success" | "danger" | "info" | "neutral";
const DOT_BG: Readonly<Record<Dot, string>> = {
  success: "bg-success-graphic",
  danger: "bg-danger-graphic",
  info: "bg-info-graphic",
  neutral: "bg-neutral-graphic",
};

function Status(props: { readonly dot: Dot; readonly children: ReactNode }): ReactNode {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-ui-dense text-text-secondary">
      <span
        aria-hidden
        className={`inline-block size-1.5 flex-none rounded-full ${DOT_BG[props.dot]}`}
      />
      <span className="truncate">{props.children}</span>
    </span>
  );
}

function dotOfState(row: TestRowVM): Dot {
  switch (row.state) {
    case "running":
      return "info";
    case "passed":
      return "success";
    case "failed":
      return "danger";
    default:
      return assertNever(row.state, "TestState");
  }
}

/** 결과 칸의 점: replay는 판정으로, Test run은 상태로 고른다 */
function resultDotOf(row: TestRowVM): Dot {
  if (row.state === "running" || row.replay === null) return dotOfState(row);
  return replayVerdictOf(row.replay).kind === "same" ? "success" : "danger";
}

/** 상태 글 한 쌍: Test run 구역은 상태, 재실행 검사 구역은 결과(판정과 통과 수) */
function TestStatus(props: { readonly row: TestRowVM }): ReactNode {
  const { row } = props;
  return row.kind === "testRun" ? (
    <Status dot={dotOfState(row)}>{t(STATE_TEXT[row.state])}</Status>
  ) : (
    <Status dot={resultDotOf(row)}>{resultTextOf(row)}</Status>
  );
}

function TestCell(props: { readonly row: TestRowVM; readonly column: TestColumnKey }): ReactNode {
  const { row, column } = props;
  switch (column) {
    case "kind":
      return t(KIND_TEXT[row.kind]);
    case "target":
      return row.target;
    case "state":
      return <Status dot={dotOfState(row)}>{t(STATE_TEXT[row.state])}</Status>;
    case "result":
      return <Status dot={resultDotOf(row)}>{resultTextOf(row)}</Status>;
    case "time":
      return timeTextOf(row.startedMs);
    default:
      return assertNever(column, "TestColumnKey");
  }
}

/** 결과 칸의 글. replay는 판정과 통과 수, Test run은 상태다 */
function resultTextOf(row: TestRowVM): string {
  if (row.state === "running") return t(STATE_TEXT.running);
  if (row.replay === null) return t(STATE_TEXT[row.state]);
  const verdict = replayVerdictOf(row.replay);
  const key =
    verdict.kind === "same"
      ? "desktop.tests.result.replayPassed"
      : verdict.kind === "digest-differs"
        ? "desktop.tests.result.replayDiffers"
        : "desktop.tests.result.replayFailed";
  return t(key, { passed: row.replay.passed, commits: row.replay.commits });
}
